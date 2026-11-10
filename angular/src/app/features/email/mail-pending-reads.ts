interface PendingRead {
    /** The person's value. */
    readonly seen: boolean;
    /** Which choice this is: a later choice for the same message replaces it, and this one's answer applies nothing. */
    readonly token: number;
    /** The server's sequence for the message as the write's answer gave it, when it gives one. */
    answerSeq: number | null;
    /** The tick at which the action's own write answered; null while it is on its way. */
    answeredAt: number | null;
    /** The notice that said the change was made, replaced if the server then refuses it. */
    noticeId: number | null;
}

/** What a live event for a message whose read state the person chose meant. */
export type PendingReadEvent =
    /** No choice pending for it: the event applies as it is. */
    | 'none'
    /** Arrived before the write answered: the old state still arriving; the person's value is kept. */
    | 'held'
    /** The first event after the answer, with the person's value: the change stands. */
    | 'confirmed'
    /** The first event after the answer, with the other value: the server refused the change, and it goes back. */
    | 'refused';

/**
 * The read state a person chose (Mark read, Mark unread) for messages, while it is being written.
 *
 * Only what was read or sent BEFORE the write answered is held off: a list or a detail whose request started before
 * the answer, and a live event arriving before it. After the answer the server is authoritative: the first live event
 * for the message ends the choice, and when it carries the other value the server refused the change (its worker can
 * roll a store back after the write has answered), which the page says.
 */
export class PendingReads {
    private readonly entries = new Map<string, PendingRead>();
    private clock = 0;
    private tokens = 0;

    /** The person chose this read state for these messages (the last choice wins); the token names this choice. */
    chosen(ids: Iterable<string>, seen: boolean): number {
        const token = ++this.tokens;
        for (const id of ids) {
            this.entries.set(id, { seen, token, answerSeq: null, answeredAt: null, noticeId: null });
        }
        return token;
    }

    /**
     * The same change reached more rows than were chosen (on Gmail, the message's row in each of its labels): they
     * join this choice, unless the person chose otherwise for one of them since.
     */
    join(ids: Iterable<string>, token: number, seen: boolean): void {
        for (const id of ids) {
            const entry = this.entries.get(id);
            if (entry === undefined || entry.token < token) {
                this.entries.set(id, { seen, token, answerSeq: null, answeredAt: null, noticeId: null });
            }
        }
    }

    /** Whether this choice is still the person's last for the message: an earlier one's answer applies nothing. */
    current(id: string, token: number): boolean {
        return this.entries.get(id)?.token === token;
    }

    /**
     * The write of this choice answered for these; `noticeId` is the notice that said so, and `seq` the server's
     * sequence for each message when the answer carries one. A choice replaced since is left alone.
     */
    answered(
        ids: Iterable<string>,
        token: number,
        noticeId: number | null,
        seq: ReadonlyMap<string, number> = new Map(),
    ): void {
        const at = ++this.clock;
        for (const id of ids) {
            const entry = this.entries.get(id);
            if (entry !== undefined && entry.token === token) {
                entry.answeredAt = at;
                entry.noticeId = noticeId;
                entry.answerSeq = seq.get(id) ?? null;
            }
        }
    }

    /** The write of this choice was refused in its answer: nothing is held for these (a later choice stays). */
    refused(ids: Iterable<string>, token: number): void {
        for (const id of ids) {
            if (this.entries.get(id)?.token === token) {
                this.entries.delete(id);
            }
        }
    }

    /** The tick a read of the list or of a message starts at: what it brings back is weighed against it. */
    stamp(): number {
        return this.clock;
    }

    /** A row from a read started at `startedAt`: the person's value when that read began before the write answered. */
    held<T extends { readonly id: string; readonly seen?: boolean }>(row: T, startedAt: number): T {
        const entry = this.entries.get(row.id);
        if (entry === undefined || row.seen === entry.seen) {
            return row;
        }
        if (entry.answeredAt !== null && startedAt >= entry.answeredAt) {
            return row;
        }
        return { ...row, seen: entry.seen };
    }

    heldAll<T extends { readonly id: string; readonly seen?: boolean }>(rows: readonly T[], startedAt: number): T[] {
        return this.entries.size === 0 ? [...rows] : rows.map(row => this.held(row, startedAt));
    }

    /**
     * A live event (its sequence `seq`) said this message's read state: what it means for the person's choice (see
     * PendingReadEvent). An event older than the sequence the write's answer gave is held off as stale.
     */
    event(id: string, seen: boolean, seq: number | null = null): PendingReadEvent {
        const entry = this.entries.get(id);
        if (entry === undefined) {
            return 'none';
        }
        if (entry.answerSeq !== null && seq !== null && seq < entry.answerSeq) {
            return 'held';
        }
        if (entry.answeredAt === null) {
            return seen === entry.seen ? 'confirmed' : 'held';
        }
        this.entries.delete(id);
        return seen === entry.seen ? 'confirmed' : 'refused';
    }

    /** The person's value for this message while a choice is pending. */
    choice(id: string): boolean | null {
        return this.entries.get(id)?.seen ?? null;
    }

    /** The notice that said this message's change was made. */
    notice(id: string): number | null {
        return this.entries.get(id)?.noticeId ?? null;
    }

    /** The server said it refused the change (mail.flag.refused): the choice ends; the next event restores the row. */
    refusedByServer(id: string): void {
        this.entries.delete(id);
    }

    /** Lets every choice go (the page is closing). */
    clear(): void {
        this.entries.clear();
    }
}

/**
 * The server's sequence for the message in a read-state write's answer, when the answer carries one (`seq`); null
 * otherwise, and then the live follower's own sequence marks keep stale events out as before.
 */
export function answerSeq(answer: unknown): number | null {
    // The answer's shape: {id, seen|flagged, seq, ids}; today's server answers no seq and no ids.
    const seq = answer !== null && typeof answer === 'object' ? (answer as { seq?: unknown }).seq : undefined;
    return typeof seq === 'number' && Number.isFinite(seq) ? seq : null;
}
