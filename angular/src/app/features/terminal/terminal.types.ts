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
}
