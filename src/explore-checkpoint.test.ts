import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicJson, digest, isDigest, readCheckpoint } from "./explore-checkpoint.ts";

test("checkpoint is replaced atomically and retains the pending action",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"toddle-checkpoint-"));
  try{
    const path=join(dir,"checkpoint.json");
    const first={schema:1,queue:[{id:0,actions:["Planning","Classroom"]}]};
    await atomicJson(path,first);
    assert.deepEqual(await readCheckpoint(path),first);
    const next={schema:1,queue:[{id:0,actions:["Classroom"]}]};
    await atomicJson(path,next);
    assert.deepEqual(await readCheckpoint(path),next);
    assert.deepEqual(await readdir(dir),["checkpoint.json"]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("state digest is stable, changes with scope and validates format",()=>{
  const a=digest("demo|Planning"), b=digest("demo|Classroom");
  assert.equal(a,digest("demo|Planning"));
  assert.notEqual(a,b);
  assert.ok(isDigest(a));
  assert.equal(isDigest("raw-url"),false);
});
