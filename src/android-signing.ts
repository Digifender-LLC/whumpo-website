// Android app com.whumpo.android: Digital Asset Links body and the passkey origin derived from its signing key.
const appSigning='40:8B:8F:8E:AA:DF:43:A9:5F:D6:CB:6A:ED:83:D6:E4:BD:8A:01:D3:E3:2F:88:1B:D9:2D:EE:31:F2:E9:DC:FE';
const uploadKey='26:39:DF:A4:76:DC:6A:A5:BE:7F:E4:76:24:47:A2:B9:22:2F:7C:D8:14:FD:B6:81:E6:5F:47:58:1E:73:C0:63';
/** App-signing key first; the upload key lets builds signed with it before Play re-signing verify too. */
export const assetLinks=[{relation:['delegate_permission/common.get_login_creds','delegate_permission/common.handle_all_urls'],
 target:{namespace:'android_app',package_name:'com.whumpo.android',sha256_cert_fingerprints:[appSigning,uploadKey]}}];
export const assetLinksBody=JSON.stringify(assetLinks,null,2)+'\n';
export function androidApkKeyHashOrigin(fingerprint:string):string{
 const bytes=fingerprint.split(':').map(h=>parseInt(h,16));
 return 'android:apk-key-hash:'+btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
/** Strict allowlist. Only the Play app-signing key: Play re-signs every installed build with it; the upload key is not an installed identity. */
export const androidPasskeyOrigins=[androidApkKeyHashOrigin(appSigning)];
