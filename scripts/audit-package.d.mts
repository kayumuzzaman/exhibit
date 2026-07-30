export type PackageAudit = Readonly<{
  files: readonly string[];
  manifestVersion: number;
  permissions: readonly string[];
  optionalHostPermissions: readonly string[];
  hostPermissions: readonly string[];
  contentSecurityPolicy: unknown;
  externallyConnectable: unknown;
  remoteUrls: readonly string[];
  remoteScripts: readonly string[];
  inlineScripts: readonly string[];
  /** Evidence-capable persistent storage APIs found in the shipped bytes. */
  evidenceAtRest: readonly string[];
}>;

export declare function auditPackage(directory: string): Promise<PackageAudit>;
