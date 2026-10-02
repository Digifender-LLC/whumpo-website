// Synthetic provider-vault configuration. This helper never reads secrets.
export function fixtureKeyring(secret='ab'.repeat(32),active='fixture-current',retained=[]){
 return JSON.stringify({version:2,active,keys:[{id:active,secret},...retained]});
}
