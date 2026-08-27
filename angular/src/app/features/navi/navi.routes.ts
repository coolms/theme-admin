import { type Routes } from '@angular/router';
import { NaviTreesListComponent } from './navi-trees-list.component';
import { NaviNodesListComponent } from './navi-nodes-list.component';

export const NAVI_ROUTES: Routes = [
    { path: '', component: NaviTreesListComponent },
    { path: ':treeSlug/nodes', component: NaviNodesListComponent },
];
