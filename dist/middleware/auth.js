import { forbidden, unauthorized } from "../lib/errors.js";
import { resolveAuthUser, verifyAccessToken } from "../services/authService.js";
export async function authenticate(req, _res, next) {
    try {
        const header = req.header("authorization");
        if (!header?.startsWith("Bearer ")) {
            throw unauthorized();
        }
        const token = header.slice(7);
        const userId = await verifyAccessToken(token);
        req.user = await resolveAuthUser(userId);
        next();
    }
    catch (err) {
        next(err);
    }
}
export function requireOwner(req, _res, next) {
    try {
        const user = req.user;
        if (!user)
            throw unauthorized();
        if (!user.roles.includes("owner"))
            throw forbidden("Hanya owner yang dapat akses");
        next();
    }
    catch (err) {
        next(err);
    }
}
export function requirePermission(...codes) {
    return (req, _res, next) => {
        try {
            const user = req.user;
            if (!user)
                throw unauthorized();
            if (user.roles.includes("owner"))
                return next();
            const ok = codes.some((c) => user.permissions.includes(c));
            if (!ok)
                throw forbidden();
            next();
        }
        catch (err) {
            next(err);
        }
    };
}
//# sourceMappingURL=auth.js.map