import { consoleEntry } from '@coolms/core-angular';
import { VfsFileDetailSlotComponent } from '../vfs-file-detail-slot.component';
import { VfsFilesSlotComponent } from '../vfs-files-slot.component';
import { VfsTreeSlotComponent } from '../vfs-tree-slot.component';
import { VfsState } from '../vfs.state';

/**
 * VFS's console entry: the file manager (full height), the three slot
 * components its server layout names, and the VFS state the store carries
 * (console@1).
 */
export default consoleEntry({
    module:   'vfs',
    contract: 'console',
    range:    '^1.0',
    routes: [
        {
            path:     'vfs',
            children: () => import('../vfs.routes').then(m => m.VFS_ROUTES),
            nav:      { fullHeight: true },
        },
    ],
    bindings: [
        { name: 'VfsTree',       component: VfsTreeSlotComponent },
        { name: 'VfsGrid',       component: VfsFilesSlotComponent },
        { name: 'VfsFileDetail', component: VfsFileDetailSlotComponent },
    ],
    states: [VfsState],
});
