export interface TerminalExecuteEvent {
    line?: string;
    done?: boolean;
    error?: string;
    /**
     * A new working directory, emitted by `cd`.
     *
     * Its own event kind rather than a specially-formatted `line`, because a
     * command that happened to print the same shape would otherwise move the
     * shell instead of printing.
     */
    cwd?: string;
}

export interface TerminalCompleteResponse {
    suggestions: string[];
    /** How many matched in all. More than `suggestions.length` means capped. */
    total?: number;
}

/** A completion answer: what to show, and what it is a part of. */
export interface TerminalCompletions {
    suggestions: string[];
    total: number;
}

/**
 * The server answered the execute request with a status instead of a stream.
 * `detail` is the problem detail when the body carried one, else `HTTP <status>`.
 * A 403 is the one the terminal can act on: the session needs elevating.
 */
export class TerminalRefusedError extends Error {
    constructor(
        public readonly status: number,
        public readonly detail: string,
    ) {
        super(detail);
        this.name = 'TerminalRefusedError';
    }
}

