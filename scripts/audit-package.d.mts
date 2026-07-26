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
}>;

export declare function auditPackage(directory: string): Promise<PackageAudit>;
