import {
    AfterViewInit, ChangeDetectionStrategy, Component,
    DestroyRef, effect, ElementRef, inject, OnDestroy, OnInit, ViewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon }      from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Store } from '@ngxs/store';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthState, ElevationService, ErrorHandlerService, ThemeService, UserPreferencesService, type ResolvedTheme } from '@coolms/core-angular';
import { TerminalService } from './terminal.service';
import { TerminalRefusedError } from './terminal.types';
import { TerminalHistoryService } from './terminal-history.service';

/** Where a fresh shell starts, and the server's own default. */
const CWD_ROOT = '/';

/** Prefs slot for the remembered working directory. */
const CWD_PREFS_KEY = 'terminal';

/** Wrong answers a `sudo` prompt takes before it gives up, as the OS's sudo does. */
const SUDO_TRIES = 3;

/** A line the person began with `sudo`: the one kind of line that may ask for the password. */
export function isSudoLine(line: string): boolean {
    return /^sudo(\s|$)/.test(line.trim());
}

/**
 * The password -- and the code, when the server asks for one -- of a `sudo` line, read into its own buffer
 * (2026-10-13, the sudo model: "the shell UI's password prompt for sudo, masked, never echoed or kept in history").
 */
interface SudoPrompt {
    /** The `sudo` line, sent again once the session is elevated. */
    readonly line: string;
    stage: 'password' | 'code';
    buffer: string;
    /** Held between the password and the code stage, and no longer. */
    password: string;
    tries: number;
    /** An answer is on its way to the server: keys wait, Ctrl+C still cancels. */
    busy: boolean;
}

/**
 * The terminal followed no theme at all -- its palette was sixteen literals,
 * so a light admin got a dark slab. xterm takes plain colour strings and will
 * not parse `var()`, so the palette is READ from the tokens rather than
 * referencing them: the chrome then tracks the theme, a user's accent override
 * included, without a second source of truth.
 *
 * The ANSI slots stay literal on purpose. They are terminal semantics with no
 * `--cms-*` equivalent, and each theme needs its own set -- a green legible on
 * #111827 is not legible on #ffffff.
 */
const ANSI_DARK = {
    black:       '#1f2937',
    red:         '#ef4444',
    green:       '#22c55e',
    yellow:      '#eab308',
    blue:        '#60a5fa',
    magenta:     '#a855f7',
    cyan:        '#22d3ee',
    white:       '#e5e7eb',
    brightBlack: '#4b5563',
    brightWhite: '#f9fafb',
};

const ANSI_LIGHT = {
    black:       '#111827',
    red:         '#b91c1c',
    green:       '#15803d',
    yellow:      '#a16207',
    blue:        '#1d4ed8',
    magenta:     '#7e22ce',
    cyan:        '#0e7490',
    white:       '#374151',
    brightBlack: '#6b7280',
    brightWhite: '#111827',
};

/** Only reached if a token is missing; kept away from the token NAMES so the
 *  fallback guard cannot read them as a var() fallback that disagrees. */
const CHROME_DARK  = { bg: '#111827', fg: '#e5e7eb', sel: '#374151' };
const CHROME_LIGHT = { bg: '#ffffff', fg: '#111827', sel: '#dbeafe' };

function readToken(name: string, fallback: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();

    return '' === value ? fallback : value;
}

function terminalTheme(theme: ResolvedTheme): ITheme {
    const isDark  = 'dark' === theme;
    const chrome  = isDark ? CHROME_DARK : CHROME_LIGHT;
    const surface = readToken('--cms-surface', chrome.bg);
    const ink     = readToken('--cms-text', chrome.fg);

    return {
        background:          surface,
        foreground:          ink,
        // A block caret INVERTS: the cell is filled with `cursor` and the glyph
        // drawn in `cursorAccent`. Pointing them at ink and surface makes it
        // maximally legible in either theme by construction, rather than
        // picking a hue that has to be checked against both.
        cursor:              ink,
        cursorAccent:        surface,
        selectionBackground: readToken('--cms-info-subtle', chrome.sel),
        ...(isDark ? ANSI_DARK : ANSI_LIGHT),
    };
}

@Component({
    selector: 'app-terminal',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div #termEl style="height:100%; width:100%"></div>`,
    styles: [`:host { display:block; height:100%; width:100%; }`],
})
export class TerminalComponent implements OnInit, OnDestroy, AfterViewInit {
    @ViewChild('termEl') termEl!: ElementRef<HTMLDivElement>;

    private term!:      Terminal;
    private fitAddon!:  FitAddon;
    private resizeObs!: ResizeObserver;

    private currentLine = '';
    private executing   = false;

    /**
     * The shell's working directory.
     *
     * Client-held on purpose: the server resolves paths against whatever
     * arrives with each command, so nothing expires and two tabs are two
     * independent shells. Restored from prefs on mount so a reload does not
     * drop you back at the root mid-task.
     */
    private cwd = CWD_ROOT;

    private readonly svc        = inject(TerminalService);
    private readonly history    = inject(TerminalHistoryService);
    private readonly prefs      = inject(UserPreferencesService);
    private readonly store      = inject(Store);
    private readonly destroyRef = inject(DestroyRef);
    private readonly theme      = inject(ThemeService);
    private readonly elevation  = inject(ElevationService);
    private readonly errors     = inject(ErrorHandlerService);

    /**
     * The open `sudo` prompt, or null. While it is open, every key goes to {@link handleSudoKey}. Nothing typed into
     * it is written to the terminal, not even a mask, and nothing reaches the history. It is emptied the moment it is
     * sent or abandoned.
     */
    private sudo: SudoPrompt | null = null;

    constructor() {
        // Re-themes a LIVE terminal: xterm re-renders from options.theme, so
        // the scrollback survives. Guarded because the effect runs before
        // ngAfterViewInit, where the terminal is built with the same value.
        effect(() => {
            const next = terminalTheme(this.theme.resolved());
            if (this.term) this.term.options.theme = next;
        });
    }

    ngOnInit(): void {
        const saved = this.prefs.getPageState<{ cwd?: string }>(CWD_PREFS_KEY)?.cwd;
        // A stored path is NOT re-validated here: the directory may have been
        // deleted or un-shared since, and the first command will say so in the
        // server's own words. Blocking startup on a VFS round-trip to pre-empt
        // that would trade a clear error for a slower terminal.
        if (saved !== undefined && saved !== '') {
            this.cwd = saved;
        }
    }

    /** Remember the directory across reloads -- the shell-like part of a shell. */
    private persistCwd(): void {
        this.prefs.setPageState(CWD_PREFS_KEY, { cwd: this.cwd });
    }

    ngAfterViewInit(): void {
        this.term = new Terminal({
            theme: terminalTheme(this.theme.resolved()),
            fontFamily:  '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
            fontSize:    13,
            lineHeight:  1.4,
            cursorBlink: true,
            convertEol:  true,
            scrollback:  2000,
            allowProposedApi: true,
        });

        this.fitAddon = new FitAddon();
        this.term.loadAddon(this.fitAddon);
        this.term.loadAddon(new WebLinksAddon());
        this.term.open(this.termEl.nativeElement);
        this.fitAddon.fit();

        // Auto-fit on container resize
        this.resizeObs = new ResizeObserver(() => {
            try { this.fitAddon.fit(); } catch { /* ignore */ }
        });
        this.resizeObs.observe(this.termEl.nativeElement);

        this.writeWelcome();
        this.writePrompt();

        this.term.onKey(({ key, domEvent }) => this.handleKey(key, domEvent));
    }

    ngOnDestroy(): void {
        this.clearSudo();
        this.resizeObs?.disconnect();
        this.svc.abort();
        this.term?.dispose();
    }

    // -- Key handling -------------------------------------------------------

    private handleKey(key: string, event: KeyboardEvent): void {
        // A `sudo` prompt takes every key: none of them is the shell's line, its history or its output.
        if (this.sudo) {
            this.handleSudoKey(key, event);
            return;
        }
        // Allow Ctrl+C during execution
        if (this.executing && !(event.ctrlKey && event.key === 'c')) return;
        if (this.executing && event.ctrlKey && event.key === 'c') {
            this.term.writeln('^C');
            this.svc.abort();
            this.executing = false;
            this.currentLine = '';
            this.writePrompt();
            return;
        }

        switch (event.key) {
            case 'Enter': {
                this.term.writeln('');
                const line = this.currentLine.trim();
                this.history.push(line);
                this.history.resetPointer();
                this.currentLine = '';
                if (line) this.execute(line);
                else       this.writePrompt();
                break;
            }

            case 'Backspace':
                if (this.currentLine.length > 0) {
                    this.currentLine = this.currentLine.slice(0, -1);
                    this.term.write('\b \b');
                }
                break;

            case 'Tab':
                event.preventDefault();
                this.requestCompletion();
                break;

            case 'ArrowUp': {
                event.preventDefault();
                const prev = this.history.prev();
                if (prev !== null) this.replaceCurrentLine(prev);
                break;
            }

            case 'ArrowDown': {
                event.preventDefault();
                const next = this.history.next();
                this.replaceCurrentLine(next ?? '');
                break;
            }

            case 'l':
                if (event.ctrlKey) {
                    event.preventDefault();
                    this.term.clear();
                    // Clear the BUFFER too, not just the screen. Without this the
                    // half-typed line survives invisibly and the next Enter runs
                    // it -- found while driving the terminal to verify .
                    this.currentLine = '';
                    this.writePrompt();
                    break;
                }
                // Not Ctrl+L -- fall through to printable character handling
                this.currentLine += key;
                this.term.write(key);
                break;

            default:
                // Printable characters only
                if (!event.ctrlKey && !event.altKey && !event.metaKey && key.length === 1) {
                    this.currentLine += key;
                    this.term.write(key);
                }
        }
    }

    // -- Execution ----------------------------------------------------------

    /**
     * @param afterGrant true when this is the one re-send after an elevation
     *                   grant: a second refusal is then printed, not prompted for.
     */
    private execute(line: string, afterGrant = false): void {
        this.executing = true;

        this.svc.execute(line, this.cwd).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: event => {
                if (event.done) {
                    this.executing = false;
                    this.writePrompt();
                } else if (event.cwd !== undefined) {
                    // `cd` succeeded. The server already validated the target
                    // and normalised it, so this is the authoritative path --
                    // the client never resolves `..` itself, or the two would
                    // drift the first time the rules disagreed.
                    this.cwd = event.cwd;
                    this.persistCwd();
                } else if (event.line !== undefined) {
                    this.term.writeln(event.line);
                }
            },
            error: err => {
                const elevationRequired = err instanceof TerminalRefusedError && err.elevationRequired;
                // The sudo model (2026-10-13): no implicit elevation in the shell. Only a line the person began
                // with `sudo`, refused for want of an elevated session, asks -- for the password, in the shell, as
                // sudo does -- and is sent again once on the grant, as the person. Any other line refused so is
                // shown, with the way to run it; a refusal for any other reason is shown and left alone.
                if (elevationRequired && !afterGrant && isSudoLine(line)) {
                    this.askSudo(line);
                    return;
                }
                this.term.writeln(`\x1b[31m✗ ${(err as Error).message ?? 'Command failed'}\x1b[0m`);
                if (elevationRequired && !isSudoLine(line) && !/\bsudo\b/.test((err as Error).message)) {
                    this.term.writeln(`\x1b[2muse sudo ${line}\x1b[0m`);
                }
                this.executing = false;
                this.writePrompt();
            },
            complete: () => {
                if (this.executing) {
                    this.executing = false;
                    this.writePrompt();
                }
            },
        });
    }

    // -- sudo ----------------------------------------------------------------

    /** Opens the password prompt for a `sudo` line the server refused for want of an elevated session. */
    private askSudo(line: string): void {
        this.sudo = { line, stage: 'password', buffer: '', password: '', tries: 0, busy: false };
        this.writeSudoPrompt();
    }

    private writeSudoPrompt(): void {
        if (!this.sudo) return;
        const user = this.store.selectSnapshot(AuthState.currentUser);
        const account = user?.identifier ?? user?.email ?? 'this account';
        this.term.write(this.sudo.stage === 'password'
            ? `[sudo] password for ${account}: `
            : '[sudo] code from your authenticator: ');
    }

    /** Every key while the prompt is open: kept in the prompt's buffer, never written, never in the history. */
    private handleSudoKey(key: string, event: KeyboardEvent): void {
        const sudo = this.sudo;
        if (!sudo) return;
        if (event.ctrlKey && event.key === 'c') {
            this.term.writeln('^C');
            this.endSudo();
            return;
        }
        if (sudo.busy) return;
        switch (event.key) {
            case 'Enter':
                this.term.writeln('');
                this.submitSudo(sudo);
                return;
            case 'Backspace':
                sudo.buffer = sudo.buffer.slice(0, -1);
                return;
            default:
                if (!event.ctrlKey && !event.altKey && !event.metaKey && key.length === 1) {
                    sudo.buffer += key;
                }
        }
    }

    /**
     * The answer goes to the same elevation the admin's own prompt grants -- POST /auth/elevation, the same lifetime
     * -- and the line is sent again once on the grant. 428: the password was right and a code is asked for. 403: a
     * wrong answer, three of which end it. Anything else is said in the server's words, and ends it.
     */
    private submitSudo(sudo: SudoPrompt): void {
        const answer = sudo.buffer;
        sudo.buffer = '';
        if (answer === '') {
            this.term.writeln(sudo.stage === 'password' ? 'sudo: no password was given' : 'sudo: no code was given');
            this.endSudo();
            return;
        }
        if (sudo.stage === 'password') sudo.password = answer;
        sudo.busy = true;
        this.elevation.elevate(sudo.password, sudo.stage === 'code' ? answer : undefined).pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe({
            next: () => {
                // Cancelled while the answer was on its way: the session is elevated, the line is not run.
                if (this.sudo !== sudo) return;
                this.clearSudo();
                this.execute(sudo.line, true);
            },
            error: (err: unknown) => {
                if (this.sudo !== sudo) return;
                sudo.busy = false;
                const status = err instanceof HttpErrorResponse ? err.status : 0;
                if (status === 428) {
                    sudo.stage = 'code';
                    this.writeSudoPrompt();
                    return;
                }
                if (status === 403) {
                    sudo.tries += 1;
                    sudo.stage = 'password';
                    sudo.password = '';
                    if (sudo.tries >= SUDO_TRIES) {
                        this.term.writeln(`sudo: ${SUDO_TRIES} incorrect attempts`);
                        this.endSudo();
                        return;
                    }
                    this.term.writeln('Sorry, try again.');
                    this.writeSudoPrompt();
                    return;
                }
                this.term.writeln(status === 429
                    ? 'sudo: too many attempts; wait a few minutes and try again.'
                    : `sudo: ${this.errors.humanize(err)}`);
                this.endSudo();
            },
        });
    }

    /** The prompt closes, its buffer and the password emptied; the shell's own prompt comes back. */
    private endSudo(): void {
        this.clearSudo();
        this.executing = false;
        this.writePrompt();
    }

    private clearSudo(): void {
        if (this.sudo) {
            this.sudo.buffer = '';
            this.sudo.password = '';
        }
        this.sudo = null;
    }

    // -- Tab completion -----------------------------------------------------

    private requestCompletion(): void {
        const cursorPos = this.currentLine.length;

        this.svc.complete(this.currentLine, cursorPos, this.cwd, this.homeDir() || '/').pipe(
            takeUntilDestroyed(this.destroyRef),
        ).subscribe(({ suggestions, total }) => {
            if (suggestions.length === 0) {
                // Bell
                this.term.write('\x07');
            } else if (suggestions.length === 1 && total === 1) {
                // Complete immediately
                const completion = suggestions[0];
                const partial    = this.extractPartial(this.currentLine);
                const toAdd      = completion.slice(partial.length);
                this.currentLine += toAdd;
                this.term.write(toAdd);
            } else {
                // Show the options -- and, when the server capped them, say
                // how many there were. Printing a hundred of eighteen hundred
                // without a word would read as the whole set.
                this.term.writeln('');
                for (const s of suggestions) {
                    this.term.write(`  \x1b[36m${s}\x1b[0m  `);
                }
                this.term.writeln('');
                if (total > suggestions.length) {
                    const rest = total - suggestions.length;
                    this.term.writeln(`\x1b[2m  ${suggestions.length} of ${total}; ${rest} more not shown -- type more to narrow\x1b[0m`);
                }
                this.writePrompt();
                this.term.write(this.currentLine);
            }
        });
    }

    private extractPartial(line: string): string {
        const tokens = line.trimEnd().split(/\s+/);
        return line.endsWith(' ') ? '' : (tokens.at(-1) ?? '');
    }

    // -- Helpers ------------------------------------------------------------

    private writeWelcome(): void {
        this.term.writeln('\x1b[34m╭─────────────────────────────╮\x1b[0m');
        this.term.writeln('\x1b[34m│\x1b[0m  \x1b[1mCoolMS2 Terminal\x1b[0m           \x1b[34m│\x1b[0m');
        this.term.writeln('\x1b[34m│\x1b[0m  Type \x1b[32mhelp\x1b[0m for commands     \x1b[34m│\x1b[0m');
        this.term.writeln('\x1b[34m╰─────────────────────────────╯\x1b[0m');
        this.term.writeln('');
    }

    /**
     * `coolms:{where} >` -- the working directory is in the prompt, which is the
     * whole point of having one.
     *
     * Home contracts to `~`, mirroring `TerminalPath::forPrompt()` on the
     * server. A home path is `/home/{uuid}`; spelled out it would fill the line
     * and tell the reader nothing they did not already know.
     */
    private writePrompt(): void {
        const home = this.homeDir();
        let where = this.cwd;
        if (home && (where === home || where.startsWith(home + '/'))) {
            where = '~' + where.slice(home.length);
        }
        this.term.write(`\x1b[32mcoolms\x1b[0m:\x1b[36m${where}\x1b[0m\x1b[32m>\x1b[0m `);
    }

    /**
     * The caller's home, derived from their user id the same way the server
     * does. Empty when unknown, which simply disables `~` contraction rather
     * than guessing a prefix and contracting the wrong path.
     */
    private homeDir(): string {
        const id = this.store.selectSnapshot(AuthState.currentUser)?.id;
        return id ? `/home/${id}` : '';
    }

    private replaceCurrentLine(newLine: string): void {
        // Clear current input on this line
        this.term.write('\r\x1b[2K');  // carriage return + erase line
        this.writePrompt();
        this.currentLine = newLine;
        this.term.write(newLine);
    }
}
