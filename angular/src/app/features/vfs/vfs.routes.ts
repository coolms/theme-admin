import { type Routes } from '@angular/router';
import { VfsManagerComponent } from './vfs-manager.component';
import { ComponentRegistry } from '@coolms/core-angular';
ComponentRegistry.register('vfs-manager', VfsManagerComponent);

export const VFS_ROUTES: Routes = [
    { path: '', component: VfsManagerComponent },
];
