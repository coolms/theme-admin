import { type CreateSectionDto, type UpdateSectionDto } from '../../api/api.service';

export class LoadSections {
    static readonly type = '[Section] Load';
}

/**
 * H7 -- admin Site Selector. `slug` of null means "no override; let the backend
 * use host-based resolution". Persisted via UserPreferencesService so the
 * selection survives page reloads.
 */
export class SetCurrentSection {
    static readonly type = '[Section] SetCurrent';
    constructor(public readonly slug: string | null) {}
}

export class CreateSection {
    static readonly type = '[Section] Create';
    constructor(public payload: CreateSectionDto) {}
}

export class UpdateSection {
    static readonly type = '[Section] Update';
    constructor(public id: string, public payload: UpdateSectionDto) {}
}

export class DeleteSection {
    static readonly type = '[Section] Delete';
    constructor(public id: string) {}
}

/**
 * H9 — invoke the nginx vhost generator (`POST /api/v1/sections/_apply`).
 * Stores the last apply result so the UI can display the reload command
 * and "Applied N section(s)" feedback. Backend is admin-only.
 */
export class ApplyNginxChanges {
    static readonly type = '[Section] ApplyNginxChanges';
}
