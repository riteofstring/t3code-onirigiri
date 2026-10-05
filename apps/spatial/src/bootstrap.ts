import { showBootError } from "@t3tools/web/src/lib/bootError";

void import("./main").then(({ startup }) => startup).catch(showBootError);
