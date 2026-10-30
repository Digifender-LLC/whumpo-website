// WH-086 activation seam. Returns a sender only when PUSH_NOTIFICATION_PROVIDER is exactly 'fcm' and the service-account secret exists; otherwise null and nothing
// can send. Nothing in the Worker calls this yet (no dispatcher lane), so a deploy cannot reach FCM whatever the secret holds.
import {fcmSender,type PushSender,type PushTransport} from './push-fcm';
export function pushSender(env:Pick<Env,'PUSH_NOTIFICATION_PROVIDER'|'FCM_SERVICE_ACCOUNT_JSON'>,transport:PushTransport):PushSender|null{
 if(env.PUSH_NOTIFICATION_PROVIDER!=='fcm'||!env.FCM_SERVICE_ACCOUNT_JSON)return null;
 return fcmSender(env.FCM_SERVICE_ACCOUNT_JSON,transport);
}
