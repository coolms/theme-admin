import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TerminalHistoryService {
    private readonly KEY      = 'coolms_terminal_history';
    private readonly MAX_SIZE = 200;

    private history: string[] = [];
    private pointer  = -1;

    constructor() {
        try {
            const stored = localStorage.getItem(this.KEY);
            this.history = stored ? JSON.parse(stored) : [];
        } catch {
            this.history = [];
        }
        this.pointer = this.history.length;
    }

    push(line: string): void {
        if (!line.trim()) return;
        // Remove duplicate if exists
        const idx = this.history.lastIndexOf(line);
        if (idx !== -1) this.history.splice(idx, 1);

        this.history.push(line);
        if (this.history.length > this.MAX_SIZE) {
            this.history.shift();
        }
        this.pointer = this.history.length;
        this.persist();
    }

    prev(): string | null {
        if (this.history.length === 0) return null;
        this.pointer = Math.max(0, this.pointer - 1);
        return this.history[this.pointer] ?? null;
    }

    next(): string | null {
        if (this.pointer >= this.history.length - 1) {
            this.pointer = this.history.length;
            return null;
        }
        this.pointer++;
        return this.history[this.pointer] ?? null;
    }

    resetPointer(): void {
        this.pointer = this.history.length;
    }

    private persist(): void {
        try {
            localStorage.setItem(this.KEY, JSON.stringify(this.history));
        } catch { /* ignore quota */ }
    }
}
