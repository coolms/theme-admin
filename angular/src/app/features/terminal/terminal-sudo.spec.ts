import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Store } from '@ngxs/store';
import { type Observable, of, throwError } from 'rxjs';
import { AuthState, ElevationService, ErrorHandlerService, ThemeService, UserPreferencesService } from '@coolms/core-angular';
import { TerminalComponent, isSudoLine, typesCharacter } from './terminal.component';
import { TerminalService } from './terminal.service';
import { TerminalHistoryService } from './terminal-history.service';
import { TerminalRefusedError, type TerminalExecuteEvent } from './terminal.types';

/**
 * The sudo model in the shell (2026-10-13): a command runs with the person's own rights, and only a line they began
 * with `sudo` asks for elevation -- for the password, IN the shell, "masked, never echoed or kept in history". The
 * real component with its real xterm; the server and the elevation endpoint are scripted.
 */
describe('TerminalComponent, sudo', () => {
    const PASSWORD = 'Secr3t-pw';
    const REFUSED = new TerminalRefusedError(403, '"sudo" needs an elevated session: elevate, then run it again.', true);

    let answers: Array<() => Observable<TerminalExecuteEvent>>;
    let completion: { suggestions: string[]; total: number; sudo: string[] };
    let executed: string[];
    let written: string[];
    let history: string[];
    let elevate: jasmine.Spy;
    let component: TerminalComponent;
    let host: HTMLElement;

    function type(text: string): void {
        for (const ch of text) key(ch);
    }

    function key(k: string, init: KeyboardEventInit = {}): void {
        const name = k === '\r' ? 'Enter' : k === '\x7f' ? 'Backspace' : k;
        (component as unknown as { handleKey(key: string, e: KeyboardEvent): void })
            .handleKey(k, new KeyboardEvent('keydown', { key: name, ...init }));
    }

    function enter(): void {
        key('\r');
    }

    function screen(): string {
        return written.join('');
    }

    beforeEach(() => {
        answers = [];
        completion = { suggestions: [], total: 0, sudo: [] };
        executed = [];
        written = [];
        history = [];
        elevate = jasmine.createSpy('elevate').and.returnValue(of({ elevated: true }));

        TestBed.configureTestingModule({
            imports: [TerminalComponent],
            providers: [
                {
                    provide: TerminalService,
                    useValue: {
                        execute: (line: string) => {
                            executed.push(line);
                            const next = answers.shift();
                            return next ? next() : of({ done: true } as TerminalExecuteEvent);
                        },
                        abort: () => undefined,
                        complete: () => of(completion),
                    },
                },
                {
                    provide: TerminalHistoryService,
                    useValue: {
                        push: (line: string) => history.push(line),
                        resetPointer: () => undefined,
                        prev: () => null,
                        next: () => null,
                    },
                },
                { provide: ElevationService, useValue: { elevate } },
                { provide: ErrorHandlerService, useValue: { humanize: () => 'the server says why' } },
                { provide: ThemeService, useValue: { resolved: signal('dark') } },
                { provide: UserPreferencesService, useValue: { getPageState: () => null, setPageState: () => undefined } },
                {
                    provide: Store,
                    useValue: {
                        selectSnapshot: (selector: unknown) => selector === AuthState.currentUser
                            ? { id: 'u1', identifier: 'probe@example.test' }
                            : null,
                        select: () => of(null),
                    },
                },
            ],
        });
        const fixture = TestBed.createComponent(TerminalComponent);
        host = fixture.nativeElement as HTMLElement;
        document.body.appendChild(host);
        fixture.detectChanges();
        component = fixture.componentInstance;
        const term = (component as unknown as { term: { write(d: string): void; writeln(d: string): void } }).term;
        spyOn(term, 'write').and.callFake((d: string) => { written.push(d); });
        spyOn(term, 'writeln').and.callFake((d: string) => { written.push(d + '\n'); });
    });

    afterEach(() => {
        host.remove();
    });

    it('asks for the password in the shell for a sudo line, never shows it, never keeps it, and runs the line on the grant', () => {
        answers.push(() => throwError(() => REFUSED));
        type('sudo ls');
        enter();

        expect(executed).toEqual(['sudo ls']);
        expect(screen()).toContain('[sudo] password for probe@example.test: ');

        written.length = 0;
        type(PASSWORD);
        expect(written).withContext('nothing at all is written while the password is typed').toEqual([]);
        enter();

        expect(elevate).toHaveBeenCalledOnceWith(PASSWORD, undefined);
        expect(executed).withContext('sent again once, on the grant').toEqual(['sudo ls', 'sudo ls']);
        expect(screen()).not.toContain(PASSWORD);
        expect(screen()).not.toMatch(/\*{3,}/);
        expect(history).toEqual(['sudo ls']);
        expect(history.join('\n')).not.toContain(PASSWORD);
    });

    it('does not elevate for a line without sudo: the refusal is shown with the way to run it, and nothing is asked', () => {
        answers.push(() => throwError(() => new TerminalRefusedError(403, '"rm" needs an elevated session: elevate, then run it again.', true)));
        type('rm /x');
        enter();

        expect(elevate).not.toHaveBeenCalled();
        expect(screen()).not.toContain('[sudo] password');
        expect(screen()).toContain('use sudo rm /x');
        expect(executed).toEqual(['rm /x']);
    });

    it('takes three wrong passwords, then gives up without running the line', () => {
        answers.push(() => throwError(() => REFUSED));
        elevate.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
        type('sudo ls');
        enter();
        for (let i = 0; i < 3; i++) {
            type('wrong' + i);
            enter();
        }

        expect(elevate).toHaveBeenCalledTimes(3);
        expect(screen().match(/Sorry, try again\./g)?.length).toBe(2);
        expect(screen()).toContain('sudo: 3 incorrect attempts');
        expect(executed).toEqual(['sudo ls']);
        expect(screen()).not.toContain('wrong0');
    });

    it('asks for the code when the server says the password is right and a code is needed, and shows neither', () => {
        answers.push(() => throwError(() => REFUSED));
        elevate.and.returnValues(
            throwError(() => new HttpErrorResponse({ status: 428 })),
            of({ elevated: true }),
        );
        type('sudo ls');
        enter();
        type(PASSWORD);
        enter();

        expect(screen()).toContain('[sudo] code from your authenticator: ');
        type('123456');
        enter();

        expect(elevate.calls.allArgs()).toEqual([[PASSWORD, undefined], [PASSWORD, '123456']]);
        expect(screen()).not.toContain('123456');
        expect(executed).toEqual(['sudo ls', 'sudo ls']);
    });

    it('cancels on Ctrl+C: nothing is sent, and the shell takes keys again', () => {
        answers.push(() => throwError(() => REFUSED));
        type('sudo ls');
        enter();
        type('half');
        key('c', { ctrlKey: true });

        expect(elevate).not.toHaveBeenCalled();
        expect(screen()).toContain('^C');
        written.length = 0;
        type('pwd');
        expect(screen()).withContext('the shell echoes its own line again').toContain('pwd');
    });

    it('marks the verbs that run only through sudo when Tab lists them', () => {
        completion = { suggestions: ['navi:delete', 'navi:seed', 'navi:tree'], total: 3, sudo: ['navi:delete', 'navi:seed'] };
        type('navi:');
        key('\t', { key: 'Tab' } as KeyboardEventInit);

        const listed = screen().replace(/\x1b\[[0-9;]*m/g, '');
        expect(listed).toContain('navi:delete [sudo]');
        expect(listed).toContain('navi:seed [sudo]');
        expect(listed).not.toContain('navi:tree [sudo]');
        expect(listed).toContain('navi:tree');
    });

    it('takes a password with characters of any length, and AltGr', () => {
        answers.push(() => throwError(() => REFUSED));
        type('sudo ls');
        enter();
        type('pw');
        key('\u{1F600}');
        key('@', { ctrlKey: true, altKey: true });
        enter();

        expect(elevate).toHaveBeenCalledOnceWith('pw\u{1F600}@', undefined);
    });

    it('erases one character with Backspace, not half of one', () => {
        answers.push(() => throwError(() => REFUSED));
        type('sudo ls');
        enter();
        type('ab');
        key('\u{1F600}');
        key('\x7f');
        enter();

        expect(elevate).toHaveBeenCalledOnceWith('ab', undefined);
    });

    it('takes a pasted password into an open prompt, its first line only, and shows none of it', () => {
        answers.push(() => throwError(() => REFUSED));
        type('sudo ls');
        enter();
        const data = new DataTransfer();
        data.setData('text/plain', 'Pasted-Secret\nsecond line');
        const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        (host.querySelector('textarea') ?? host).dispatchEvent(paste);
        enter();

        expect(paste.defaultPrevented).toBeTrue();
        expect(elevate).toHaveBeenCalledOnceWith('Pasted-Secret', undefined);
        expect(screen()).not.toContain('Pasted-Secret');
    });

    it('leaves a paste alone when no prompt is open', () => {
        const data = new DataTransfer();
        data.setData('text/plain', 'ls');
        const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
        (host.querySelector('textarea') ?? host).dispatchEvent(paste);

        expect(elevate).not.toHaveBeenCalled();
        expect(executed).toEqual([]);
    });

    it('counts any printable text as a typed character, AltGr included, and no control chord', () => {
        const ev = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);
        expect(typesCharacter('a', ev({}))).toBeTrue();
        expect(typesCharacter('\u{1F600}', ev({}))).withContext('outside the basic plane').toBeTrue();
        expect(typesCharacter('@', ev({ ctrlKey: true, altKey: true }))).withContext('AltGr').toBeTrue();
        expect(typesCharacter('c', ev({ ctrlKey: true }))).withContext('Ctrl+C').toBeFalse();
        expect(typesCharacter('x', ev({ altKey: true }))).withContext('Alt+x').toBeFalse();
        expect(typesCharacter('\x1b[A', ev({}))).withContext('an arrow').toBeFalse();
    });

    it('recognises a sudo line by its first word only', () => {
        expect(isSudoLine('sudo rm /x')).toBeTrue();
        expect(isSudoLine('  sudo')).toBeTrue();
        expect(isSudoLine('sudoers')).toBeFalse();
        expect(isSudoLine('echo sudo')).toBeFalse();
    });
});
