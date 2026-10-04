/** WH-071 descriptor export hook ids for the records (WH-127) and files (WH-128) kinds, resolved only from this
 * maintained table. They live apart from their serializers so the registry can name them without importing the
 * serializers (which read the registry). WH-077 composes the serializers; no route serves them. */
export const recordsExportHook='records-export-v1';
export const filesExportHook='files-export-v1';
