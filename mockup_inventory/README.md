# Inventário de fotos para MOCKUP automático

Esta pasta guarda as **fotos reais dos pontos de mídia da Kallas**. O agente usa cada foto
para aplicar a campanha do cliente em cima (via nano-banana) e gerar os slides de mockup
do deck — automaticamente, por item do plano.

## Como mandar as fotos (passar pra quem tem o acervo)

1. **As fotos** (`.jpg` ou `.png`) vão **nesta pasta**.
   - Foto **horizontal** do ponto, **boa resolução** (de preferência ≥ 1600px de largura), com a **tela/painel bem visível** e **sem** anúncio de cliente concorrente em destaque (qualquer arte serve — o agente troca).
   - Nomes de arquivo simples, sem acento/espaço: `big-mupi-santo-andre.jpg`, `led-desembarque-sdu.jpg`.

2. **O manifest** `inventory.json` (nesta pasta) lista cada foto e a **liga ao formato do plano**.
   Cada entrada:
   ```json
   {
     "formato": "Big Mupi Digital",        // DEVE casar com o nome do formato na tabela de preços / plano
     "praca": "São Paulo",                  // opcional — desempata o mesmo formato em cidades diferentes
     "arquivo": "big-mupi-santo-andre.jpg", // nome do arquivo da foto nesta pasta
     "formatoLabel": "Big Mupi Digital",    // (opcional) rótulo do slide
     "localLabel": "Santo André · SP"       // (opcional) rótulo do slide
   }
   ```
   - O campo **`formato`** é o que importa: o agente casa o formato de cada item do plano com a foto
     pelo nome (ex.: item "BIG MUPI DIGITAL · Av. Industrial" → foto cujo `formato` é "Big Mupi Digital").
   - Pode haver **várias fotos do mesmo formato** em praças diferentes — use `praca` para diferenciar.

3. Pronto. Quando a Vivi colocar as fotos + preencher o `inventory.json`, o deck passa a sair com os
   mockups **sozinho** (1 por praça, até o limite definido, para controlar custo).

## Modelo
Veja `inventory.example.json` (preenchido com os 5 pontos do teste Johnson's) como referência de formato.

## Observações
- Resolução de saída do nano-banana hoje ~1024px; para slide cheio em alta, daremos um upscale (a fazer).
- Superfície **plana** (billboard, mupi, painel, LED reto) = melhor resultado. Curva/angulada (túnel) é mais difícil.
- A pasta pode ser trocada por variável de ambiente `MOCKUP_INVENTORY_DIR`.
