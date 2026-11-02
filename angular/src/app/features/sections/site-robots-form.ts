import type { SiteRobotsTxt } from './site-robots-card.component';

/** One agent or rule line of the robots.txt as the form edits it, by the line it was read from. */
export interface RobotsFormLine {
    readonly line: number;
    /** `user-agent`, or a rule's field as the server read it (lower-cased). */
    readonly field: string;
    readonly readValue: string;
    value: string;
    /** For an Allow or Disallow rule: which of the two it is now. */
    kind: 'allow' | 'disallow' | null;
    removed: boolean;
}

export interface RobotsFormGroup {
    readonly agents: RobotsFormLine[];
    readonly rules: RobotsFormLine[];
}

/** A group being added: crawlers picked from the built-in list or typed, and its rules. */
export interface RobotsNewGroup {
    agents: string[];
    rules: { kind: 'allow' | 'disallow'; value: string }[];
}

/** What a line-by-line save sends, besides the site and the version. */
export interface RobotsLineChanges {
    readonly changes: { line: number; value: string | null; field?: 'allow' | 'disallow' }[];
    readonly group: { agents: string[]; rules: { field: 'allow' | 'disallow'; value: string }[] } | null;
}

const ruleKind = (field: string): 'allow' | 'disallow' | null =>
    field === 'allow' || field === 'disallow' ? field : null;

/** The form of a robots.txt as the server read it: each group's agent and rule lines, by their line indexes. */
export function formOf(robots: SiteRobotsTxt): RobotsFormGroup[] {
    return robots.groups.map((group) => ({
        agents: group.agents.map((agent, i) => ({
            line: group.agentLines[i], field: 'user-agent', readValue: agent, value: agent, kind: null, removed: false,
        })),
        rules: group.rules.map(([field, value], i) => ({
            line: group.ruleLines[i], field, readValue: value, value, kind: ruleKind(field), removed: false,
        })),
    }));
}

/**
 * Only what changed: a line whose value or kind changed, a line removed, and the new group when it names a crawler.
 * Every other line is not sent, so the server keeps it byte for byte.
 */
export function changesOf(form: RobotsFormGroup[], added: RobotsNewGroup): RobotsLineChanges {
    const changes: RobotsLineChanges['changes'] = [];
    for (const group of form) {
        for (const line of [...group.agents, ...group.rules]) {
            if (line.removed) {
                changes.push({ line: line.line, value: null });
                continue;
            }
            const kindChanged = line.kind !== null && line.kind !== ruleKind(line.field);
            if (line.value.trim() !== line.readValue || kindChanged) {
                changes.push(kindChanged && line.kind !== null
                    ? { line: line.line, value: line.value.trim(), field: line.kind }
                    : { line: line.line, value: line.value.trim() });
            }
        }
    }
    const agents = added.agents.map((a) => a.trim()).filter((a) => a !== '');
    const group = agents.length === 0 ? null : {
        agents,
        rules: added.rules.map((r) => ({ field: r.kind, value: r.value.trim() })),
    };

    return { changes, group };
}

/** Whether the form changes anything at all. */
export function formChanged(form: RobotsFormGroup[], added: RobotsNewGroup): boolean {
    const { changes, group } = changesOf(form, added);

    return changes.length > 0 || group !== null;
}
