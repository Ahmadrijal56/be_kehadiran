import type { NextFunction, Request, Response } from "express";
export declare function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void>;
export declare function requireOwner(req: Request, _res: Response, next: NextFunction): void;
export declare function requirePermission(...codes: string[]): (req: Request, _res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.d.ts.map