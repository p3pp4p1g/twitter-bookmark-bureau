import { postConsolidate } from "./lib";

async function main() {
  const limit = process.env.CONSOLIDATE_LIMIT ? Number(process.env.CONSOLIDATE_LIMIT) : undefined;
  const result = await postConsolidate({ limit });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
