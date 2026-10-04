import type * as React from 'react';

export type IconName = 'home' | 'globe' | 'database' | 'storage' | 'server' | 'person' | 'chat' | 'spark' | 'check' | 'alert' | 'clock' | 'send';
export type Status = 'ready' | 'working' | 'attention' | 'idle';

/** The approved elephant/star mark with the typeset wordmark. */
export interface BrandProps { src?: string; size?: 'sm' | 'md'; wordmark?: boolean; tagline?: string; className?: string }
export declare function Brand(props: BrandProps): React.ReactElement;

/** Rounded-stroke icon, drawn in currentColor. */
export interface IconProps { name: IconName; size?: number; title?: string; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

/** Pill button. Primary at most once per view. */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'quiet'; size?: 'sm' | 'md'; icon?: IconName }
export declare function Button(props: ButtonProps): React.ReactElement;

/** Status with icon + word; colour is never the only signal. */
export interface StatusBadgeProps { status?: Status; children?: React.ReactNode; className?: string }
export declare function StatusBadge(props: StatusBadgeProps): React.ReactElement;

/** One chat turn from Whumpo or the customer. */
export interface ChatMessageProps { from: 'whumpo' | 'you'; avatarSrc?: string; time?: string; children: React.ReactNode; className?: string }
export declare function ChatMessage(props: ChatMessageProps): React.ReactElement;

/** The chat input: pill field + send button. */
export interface ComposerProps { value?: string; defaultValue?: string; placeholder?: string; label?: string; onChange?: (value: string) => void; onSend?: (value: string) => void; className?: string }
export declare function Composer(props: ComposerProps): React.ReactElement;

/** Real workflow progress: ring + step list. */
export interface ProgressStep { label: string; state?: 'done' | 'active' | 'pending' }
export interface ProgressCardProps { title: string; steps: ProgressStep[]; percent?: number; className?: string }
export declare function ProgressCard(props: ProgressCardProps): React.ReactElement;

/** One service in "Your online presence". */
export interface ServiceTileProps { name: string; icon?: IconName; status?: Status; statusLabel?: string; className?: string }
export declare function ServiceTile(props: ServiceTileProps): React.ReactElement;

/** Outcome, cost and risk in plain language before paid or risky work. */
export interface ApprovalCardProps { title: string; outcome: React.ReactNode; cost: React.ReactNode; risk?: React.ReactNode; approveLabel?: string; declineLabel?: string; onApprove?: () => void; onDecline?: () => void; className?: string }
export declare function ApprovalCard(props: ApprovalCardProps): React.ReactElement;

declare global { interface Window { Whumpo: { Brand: typeof Brand; Icon: typeof Icon; Button: typeof Button; StatusBadge: typeof StatusBadge; ChatMessage: typeof ChatMessage; Composer: typeof Composer; ProgressCard: typeof ProgressCard; ServiceTile: typeof ServiceTile; ApprovalCard: typeof ApprovalCard; icons: IconName[] } } }
