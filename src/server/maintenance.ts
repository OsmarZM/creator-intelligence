let mutations = 0;
let preparing = false;
export function enterMutation() {
  if (preparing)
    throw new Error(
      "O aplicativo está preparando uma atualização. Aguarde a reabertura.",
    );
  mutations++;
  return () => {
    mutations--;
  };
}
export function prepareUpdate(agentBusy: boolean) {
  if (agentBusy || mutations)
    throw new Error(
      "Aguarde a análise ou gravação atual terminar antes de atualizar.",
    );
  preparing = true;
}
export function cancelUpdate() {
  preparing = false;
}
