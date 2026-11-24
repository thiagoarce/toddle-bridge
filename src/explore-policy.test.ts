import { test } from "node:test";
import assert from "node:assert/strict";
import {queryOnly,requestAllowed,inPlatform} from "./explore-policy.ts";
const origin="https://web.toddleapp.com";
test("allows parsed queries, rejects mutations, subscriptions and write-like fields",()=>{
 assert.equal(queryOnly("query Courses { courses { id } }"),true);
 for(const q of ["mutation X { createCourse }","subscription X { courses }","query X { alias: markRead }","query X { courses } mutation Y { deleteCourse }","not graphql"]) assert.equal(queryOnly(q),false);
});
test("request guard denies unknown POST, external hosts and restricted navigation",()=>{
 const url="https://api.toddleapp.com/graphql";
 assert.equal(requestAllowed("POST",url,{query:"query X { courses { id } }"},origin,false),true);
 assert.equal(requestAllowed("POST",url,{extensions:{}},origin,false),false);
 assert.equal(requestAllowed("POST",url,[{query:"{ courses }"}],origin,false),false);
 assert.equal(requestAllowed("DELETE",url,null,origin,false),false);
 assert.equal(requestAllowed("GET",origin+"/platform/1/students",null,origin,true),false);
 assert.equal(requestAllowed("GET","https://toddleapp.com.evil.example/",null,origin,false),false);
 assert.equal(inPlatform(origin+"/platform/1/courses",origin,"1"),true);
 assert.equal(inPlatform(origin+"/platform/2/courses",origin,"1"),false);
});
