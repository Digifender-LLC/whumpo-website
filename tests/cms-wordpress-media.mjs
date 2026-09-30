import assert from 'node:assert/strict';
import {analyzeWordPress} from '../tools/cms-wordpress-stage.mjs';
const picture=(id=2,url='https://old.example/image.jpg',alt='Bread')=>`<!-- wp:image {"id":${id}} --><figure class="wp-block-image"><img src="${url}" alt="${alt}"/><figcaption>Fresh bread</figcaption></figure><!-- /wp:image -->`;
const attachment=(id=2,url='https://old.example/image.jpg')=>`<item><title>Photo</title><wp:post_id>${id}</wp:post_id><wp:post_type>attachment</wp:post_type><wp:attachment_url>${url}</wp:attachment_url></item>`;
const analyze=async(html,media=attachment())=>analyzeWordPress(new TextEncoder().encode(`<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><wp:wxr_version>1.2</wp:wxr_version><item><title>Story</title><wp:post_id>1</wp:post_id><wp:post_type>post</wp:post_type><wp:status>draft</wp:status><content:encoded><![CDATA[${html}]]></content:encoded></item>${media}</channel></rss>`));
const original=globalThis.fetch;globalThis.fetch=()=>assert.fail('Source image analysis must never fetch URLs');
try{
 const report=await analyze(picture()),article=report.articles[0],plan=article.mediaPlan;
 assert.equal(plan.status,'needs_local_media');assert.equal(plan.fetched,false);assert.equal(plan.imageCount,1);
 assert.deepEqual(plan.images[0],{position:0,attachmentId:2,sourceURL:'https://old.example/image.jpg',attachmentURL:'https://old.example/image.jpg',alt:'Bread',caption:'Fresh bread',issues:[]});
 assert.equal(article.candidate,null);assert.equal(article.status,'needs_changes');assert.ok(article.reasons.includes('media_requires_reviewed_local_import'));
 assert.deepEqual((await analyze(picture())).articles[0].mediaPlan,plan,'Converter randomness must not affect the inventory');
 assert.equal((await analyze('<p>Only text</p>')).articles[0].mediaPlan.status,'none');
 const issue=async(reason,html,media)=>assert.ok((await analyze(html,media)).articles[0].mediaPlan.issues.includes(reason),reason);
 assert.equal((await analyze(picture(null))).articles[0].mediaPlan.images[0].attachmentId,2);
 await issue('ambiguous_source_attachment',picture(null),attachment()+attachment(3));
 await issue('missing_source_attachment',picture(9));
 await issue('source_image_variant_requires_review',picture(2,'https://old.example/image-300x200.jpg'));
 await issue('unsupported_source_image_url',picture(2,'https://user:password@old.example/image.jpg'));
 await issue('unsupported_source_image_url',picture(2,'javascript:alert(1)'));
 await issue('unsupported_media_layout','<!-- wp:gallery -->'+picture()+'<!-- /wp:gallery -->');
 await issue('unsupported_media_layout','<iframe src="https://old.example/embed"></iframe>');
 await issue('too_many_article_images',picture().repeat(5));
 const many=(await analyze(picture().repeat(5))).articles[0].mediaPlan;assert.equal(many.imageCount,5);assert.equal(many.images.length,4);
 await issue('image_description_requires_changes',picture(2,'https://old.example/image.jpg','x'.repeat(501)));
 assert.equal((await analyze(picture(2,'https://old.example/image.jpg','&lt;script&gt;bad&lt;/script&gt;'))).articles[0].candidate,null);
 console.log('WordPress image inventory passed: source attachment identity, inert URLs, deterministic mapping, variants, unsupported media, bounds and unchanged import refusal.');
}finally{globalThis.fetch=original;}
