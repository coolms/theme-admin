export class LoadNode {
    static readonly type = '[VFS] Load Node';
    constructor(public readonly path: string) {}
}

export class ChmodNode {
    static readonly type = '[VFS] Chmod Node';
    constructor(
        public readonly path: string,
        public readonly mode: string,
    ) {}
}

export class ChownNode {
    static readonly type = '[VFS] Chown Node';
    constructor(
        public readonly path: string,
        public readonly uid:  string,
        public readonly gid:  string,
    ) {}
}

export class ClearVfsNode {
    static readonly type = '[VFS] Clear Node';
}
