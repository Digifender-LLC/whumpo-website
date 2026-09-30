import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm,readdir} from 'node:fs/promises';
import {analyzeWordPress,stageWordPress,wordpressStageHTML} from '../tools/cms-wordpress-stage.mjs';
const encode=s=>new TextEncoder().encode(s);
const item=(id,html='<p>A <strong>studio</strong> story.</p>',type='post',extra='')=>`<item><title>Studio story</title><link>https://old.example/story</link><dc:creator><![CDATA[Writer Name]]></dc:creator><wp:post_id>${id}</wp:post_id><wp:post_type>${type}</wp:post_type><wp:status>publish</wp:status><wp:post_name>story</wp:post_name><content:encoded><![CDATA[${html}]]></content:encoded>${extra}</item>`;
const wxr=items=>`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Source site</title><wp:wxr_version>1.2</wp:wxr_version>${items}</channel></rss>`;
const originalFetch=globalThis.fetch;let fetches=0;globalThis.fetch=()=>{fetches++;throw Error('Staging cannot fetch remote data');};
const dir=await mkdtemp('/tmp/whumpo-wxr-stage-');
try{
 const xml=wxr(item(1)+item(2,'<p>Image</p><img src="http://169.254.169.254/latest/meta-data/">')+item(3,'','attachment','<wp:attachment_url>https://old.example/photo.jpg</wp:attachment_url>'));
 const report=await analyzeWordPress(encode(xml));assert.deepEqual(report.summary,{articles:2,reviewable:1,needsChanges:1,attachments:1});
 assert.deepEqual((await analyzeWordPress(encode(xml))).articles[0].candidate,report.articles[0].candidate);assert.equal(report.articles[0].candidate.status,'draft');assert.equal(report.articles[0].sourceAuthor,'Writer Name');assert.match(JSON.stringify(report.articles[0].candidate),/strong/);
 assert.deepEqual(report.articles[1].reasons,['media_requires_reviewed_local_import']);assert.equal(report.attachments[0].url,'https://old.example/photo.jpg');assert.equal(fetches,0);
 for(const [html,reason] of [['<script>alert(1)</script>','active_content_requires_manual_conversion'],['[gallery ids="1"]','shortcode_requires_manual_conversion'],['<!-- wp:image --><p>Photo</p><!-- /wp:image -->','media_requires_reviewed_local_import']]){const r=await analyzeWordPress(encode(wxr(item(1,html))));assert.equal(r.articles[0].candidate,null);assert.ok(r.articles[0].reasons.includes(reason));}
 assert.equal((await analyzeWordPress(encode(wxr(item(1,'<p>Secret</p>','post','<wp:post_password>secret-value</wp:post_password>'))))).articles[0].reasons[0],'password_protected_content');
 const reviewHTML=await wordpressStageHTML(report);assert.ok(reviewHTML.includes('&lt;img'));assert.ok(!reviewHTML.includes('<img'));assert.match(reviewHTML,/default-src 'none'/);assert.match(reviewHTML,/<strong>studio<\/strong>/);
 await assert.rejects(analyzeWordPress(encode(wxr(item(1)+item(1)))),/unique/);
 await assert.rejects(analyzeWordPress(encode(wxr(item(0)))),/unique/);
 await assert.rejects(analyzeWordPress(encode(wxr(item(1)).replace('<rss','<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss'))),/DTD/);
 await assert.rejects(analyzeWordPress(encode(wxr(item(1)).replace('</channel>',''))),/Malformed/);
 await assert.rejects(analyzeWordPress(encode('<rss><channel/></rss>')),/WXR/);
 await assert.rejects(analyzeWordPress(encode(wxr(Array.from({length:101},(_,i)=>item(i+1)).join('')))),/100/);
 await assert.rejects(analyzeWordPress(new Uint8Array(1048577)),/1 MiB/);
 await assert.rejects(analyzeWordPress(new Uint8Array([255])),/UTF-8/);
 await assert.rejects(analyzeWordPress(encode(wxr('<x>'.repeat(45)+'</x>'.repeat(45)))),/nesting/);
 const large=await analyzeWordPress(encode(wxr(item(1,'<p>'+'a'.repeat(6000)+'</p>'))));assert.equal(large.articles[0].candidate,null);assert.ok(large.articles[0].reasons.includes('converted_content_outside_supported_article_shape'));
 await writeFile(dir+'/source.xml',xml);const staged=await stageWordPress(dir+'/source.xml',dir+'/stages');assert.equal(await readFile(staged.directory+'/source.xml','utf8'),xml);assert.equal((await stat(staged.directory)).mode&0o777,0o700);assert.equal((await stat(staged.directory+'/review.html')).mode&0o777,0o600);assert.equal((await stat(staged.directory+'/source.xml')).mode&0o777,0o600);assert.equal((await stat(staged.directory+'/report.json')).mode&0o777,0o600);assert.equal(JSON.parse(await readFile(staged.directory+'/report.json','utf8')).source.digest,report.source.digest);
 await writeFile(dir+'/bad.xml','bad');await assert.rejects(stageWordPress(dir+'/bad.xml',dir+'/stages'));assert.equal((await readdir(dir+'/stages')).length,1);assert.equal(fetches,0);
 console.log('WordPress staging passed: upstream conversion, draft-only review candidates, source attribution/bytes, private artifacts, no fetches, media/active content/shortcode reporting, invalid XML/DTD/size/count/depth/identity refusal.');
}finally{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
