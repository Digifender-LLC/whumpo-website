// Shared navigation vocabulary; the server still owns completion and project creation.
export const welcomePrompts = ['name','picture','bio','idea','project-name','audience','style','review'] as const;
export type WelcomePrompt = typeof welcomePrompts[number];
export type WelcomeStage = 'profile'|'project'|'review';
export function welcomeStage(prompt:WelcomePrompt):WelcomeStage {
 return prompt==='review'?'review':['name','picture','bio'].includes(prompt)?'profile':'project';
}
export function firstWelcomePrompt(stage:WelcomeStage):WelcomePrompt {
 return stage==='profile'?'name':stage==='project'?'idea':'review';
}
