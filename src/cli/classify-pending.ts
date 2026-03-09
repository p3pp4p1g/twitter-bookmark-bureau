import { postClassifyPending } from "./lib";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const limit = Number(process.env.CLASSIFY_BATCH_LIMIT ?? 24);
  const delayMs = Number(process.env.CLASSIFY_BATCH_DELAY_MS ?? 1200);
  const maxRounds = Number(process.env.CLASSIFY_MAX_ROUNDS ?? 100);

  let totalClassified = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    const result = await postClassifyPending({ limit });
    totalClassified += result.classified;

    console.log(
      JSON.stringify(
        {
          round,
          classifiedThisRound: result.classified,
          totalClassified,
        },
        null,
        2,
      ),
    );

    if (!result.classified) {
      return;
    }

    await sleep(delayMs);
  }

  throw new Error(`Classification did not finish within ${maxRounds} rounds`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
