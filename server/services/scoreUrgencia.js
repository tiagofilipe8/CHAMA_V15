// ---------------------------------------------------------------------
// Score de urgência (usado em "Score de urgência" e "Sugerir rotas")
//
//   score do chamado = peso da urgência × fator de atraso × fator de prazo
//
//   peso da urgência: Requisição ×1 · Operação prejudicada ×1,5 · Parada iminente ×2 · Operação parada ×3
//   fator de atraso:  1 + dias de atraso (1 dia atrasado = ×2, 3 dias = ×4), até no máximo ATRASO_MAX dias
//   fator de prazo (balanceamento): quanto mais longe o prazo, menos pesa
//       atrasado ou vence hoje/amanhã ×1 · vence em 2–3 dias ×0,75 · 4–7 dias ×0,5 · mais de 7 dias ×0,25
//       sem data nenhuma ×0,75
//   prazo usado: "Precisa até" do chamado; se não tiver, o prazo (SLA)
//
//   score do local = soma dos scores dos chamados abertos dele
// ---------------------------------------------------------------------

const PESO_URGENCIA = { 1: 1, 2: 1.5, 3: 2, 4: 3 };
const ATRASO_MAX = 15;
const FAIXAS_PRAZO = [ // [até X dias para o prazo, fator]
  [1, 1],
  [3, 0.75],
  [7, 0.5],
  [Infinity, 0.25],
];
const FATOR_SEM_PRAZO = 0.75;

const REGRAS = {
  peso_urgencia: PESO_URGENCIA,
  atraso_max: ATRASO_MAX,
  faixas_prazo: FAIXAS_PRAZO.map(([ate, fator]) => ({ ate: ate === Infinity ? null : ate, fator })),
  fator_sem_prazo: FATOR_SEM_PRAZO,
};

// dia (AAAA-MM-DD) no fuso de São Paulo
const diaSP = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);

function calcular(t, hoje = diaSP(new Date())) {
  const peso = PESO_URGENCIA[Number(t.priority)] || 1;
  let prazo = null; let origem = null;
  if (t.needed_by) { prazo = String(t.needed_by instanceof Date ? diaSP(t.needed_by) : t.needed_by).slice(0, 10); origem = 'precisa até'; }
  else if (t.due_at) { prazo = diaSP(t.due_at); origem = 'prazo (SLA)'; }
  let diasAtraso = 0; let diasParaPrazo = null; let fatorPrazo = FATOR_SEM_PRAZO;
  if (prazo) {
    const d = diasEntre(hoje, prazo); // >0 = ainda faltam dias; <0 = atrasado
    if (d < 0) { diasAtraso = -d; fatorPrazo = 1; } else {
      diasParaPrazo = d;
      fatorPrazo = FAIXAS_PRAZO.find(([ate]) => d <= ate)[1];
    }
  }
  const fatorAtraso = 1 + Math.min(diasAtraso, ATRASO_MAX);
  const score = Math.round(peso * fatorAtraso * fatorPrazo * 100) / 100;
  return { peso, prazo, origem_prazo: origem, dias_atraso: diasAtraso, dias_para_prazo: diasParaPrazo, fator_atraso: fatorAtraso, fator_prazo: fatorPrazo, score };
}

module.exports = { calcular, REGRAS, diaSP };
