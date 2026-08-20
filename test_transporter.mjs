import { fetchMovieByTmdb, getApiTrace, clearApiTrace } from "./src/lib/media.server.ts";

clearApiTrace();
const r = await fetchMovieByTmdb(13387); // Transporter 3
console.log("title:", r?.title, "|", r ? `qualities:${r.qualities?.length} captions:${r.captions?.length}` : "NOT FOUND");
console.log(getApiTrace().join("\n"));
