import { HttpInterceptorFn } from '@angular/common/http';

import { ADMIN_CLIENT } from './client.generated';

/**
 * Names the admin on every API call: `X-CoolMS-Client: com.coolms.admin/<version>`, the header the apps send. The
 * backend counts its calls by client and version per day -- so a change that must reach every client (a header a
 * write now requires) can be seen to have reached this one. Only calls to the API carry it; assets and other origins
 * do not.
 */
export const clientHeaderInterceptor: HttpInterceptorFn = (req, next) => {
    if (!isApiCall(req.url)) {
        return next(req);
    }
    return next(req.clone({ setHeaders: { 'X-CoolMS-Client': ADMIN_CLIENT } }));
};

/** A same-origin call under `/api/`. */
function isApiCall(url: string): boolean {
    return url.startsWith('/api/');
}
