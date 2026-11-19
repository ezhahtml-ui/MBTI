"""Validate the structured question bank (xlsx + json) against the ORIGINAL source file.
usage: python3 -I validate_bank.py <bank.xlsx> <bank.json> <original.xlsx>"""
import sys, json, hashlib, collections, re, openpyxl
xl, js, orig = sys.argv[1:4]
res=[]
def chk(name, ok, detail=''): res.append((name, bool(ok), detail)); print(('PASS ' if ok else 'FAIL ')+name+(' | '+str(detail) if detail else ''))
wb=openpyxl.load_workbook(xl,data_only=True)
ws=wb['items']; hdr=[c.value for c in ws[1]]
items=[dict(zip(hdr,r)) for r in ws.iter_rows(min_row=2,values_only=True)]
J=json.load(open(js,encoding='utf-8'))
O=list(openpyxl.load_workbook(orig,data_only=True)['٣٠٠٠ پرسیار'].iter_rows(min_row=2,values_only=True))
REQ=['item_id','content_id','dichotomy','facet_id','measured_pole','scoring_direction','difficulty','discrimination','wording_template','scenario','item_style','review_status','version','duplicate_cluster','source','language','active_status']
chk('17 required fields present in items sheet', all(f in hdr for f in REQ))
chk('3000 items', len(items)==3000, len(items))
chk('item_id unique', len({i['item_id'] for i in items})==3000)
chk('text identical to original (3000)', all(items[k]['text']==O[k][1] for k in range(3000)))
chk('text_hash matches text', all(hashlib.sha256(i['text'].encode()).hexdigest()[:16]==i['text_hash'] for i in items))
chk('difficulty & discrimination all empty (no invented values)', all(i['difficulty'] is None and i['discrimination'] is None for i in items))
chk('calibration_status all uncalibrated', all(i['calibration_status']=='uncalibrated' for i in items))
chk('review_status all pending / active_status all draft', all(i['review_status']=='pending' and i['active_status']=='draft' for i in items))
LET={'EI':('E','I'),'SN':('S','N'),'TF':('T','F'),'JP':('J','P')}
chk('pole letter belongs to its dichotomy', all(i['measured_pole'] in LET[i['dichotomy']] for i in items))
chk('scoring_direction consistent with pole', all(i['scoring_direction']==(1 if i['measured_pole']==LET[i['dichotomy']][0] else -1) for i in items))
chk('facet_id starts with dichotomy', all(i['facet_id'].startswith(i['dichotomy']+'-') for i in items))
chk('content_id = facet_id-pole', all(i['content_id']==f"{i['facet_id']}-{i['measured_pole']}" for i in items))
chk('Excel pole code A/B matches letter (A=first)', all((O[k][7]=='A')==(items[k]['scoring_direction']==1) for k in range(3000)))
cc=collections.Counter(i['content_id'] for i in items); chk('40 contents x 75 items', len(cc)==40 and set(cc.values())=={75}, (len(cc),set(cc.values())))
cf=collections.Counter(i['facet_id'] for i in items); chk('20 facets x 150 items', len(cf)==20 and set(cf.values())=={150})
chk('4 dichotomies x 750', set(collections.Counter(i['dichotomy'] for i in items).values())=={750} )
chk('(facet,scenario,template) unique', len({(i['facet_id'],i['scenario'],i['wording_template']) for i in items})==3000)
# summary sheet values (computed by LibreOffice)
S={r[0]:r[1] for r in wb['summary'].iter_rows(min_row=8,max_row=18,values_only=True)}
chk('summary: items_total=3000', S['items_total']==3000, S['items_total'])
chk('summary: distinct_contents=40', S['distinct_contents']==40)
chk('summary: cells=40', S['cells_facet_x_pole']==40)
chk('summary: pending=3000 approved=0 rejected=0', (S['items_pending'],S['items_approved'],S['items_rejected'])==(3000,0,0))
chk('summary: max independent test length now = 40 (repeat=1)', S['max_independent_test_length_now']==40, S['max_independent_test_length_now'])
chk('summary: contents still needed = 440', S['contents_still_needed']==440, S['contents_still_needed'])
chk('summary: target total 480', S['contents_target_total']==480)
cs=wb['contents']; chk('contents sheet: each content has 75 variants and 30 scenarios', all(r[6]==75 and round(r[7])==30 for r in cs.iter_rows(min_row=2,values_only=True)), [ (r[6],r[7]) for r in cs.iter_rows(min_row=2,max_row=2,values_only=True)])
# json
cont={c['content_id']:c for c in J['contents']}
ok=True; bad=0
for k,it in enumerate(J['items']):
    c=cont[it['content_id']]
    text=J['scenarios'][it['scenario']]+'، '+J['templates'][it['wording_template']]+': '+c['behavior_text']
    if text!=O[k][1] or hashlib.sha256(text.encode()).hexdigest()[:16]!=it['text_hash']: bad+=1
chk('JSON: rebuilt text == original for all 3000 rows', bad==0 and len(J['items'])==3000, f'mismatches={bad}')
chk('JSON items == xlsx items (ids, content, scenario, template, style)', all((a['item_id'],a['content_id'],a['scenario'],a['wording_template'],a['item_style'])==(b['item_id'],b['content_id'],b['scenario'],b['wording_template'],b['item_style']) for a,b in zip(J['items'],items)))
chk('JSON: no invented IRT values', all(i['difficulty'] is None and i['discrimination'] is None for i in J['items']))
chk('JSON: 20 facets, 40 contents, 30 scenarios, 5 templates', (len(J['facets']),len(J['contents']),len(J['scenarios']),len(J['templates']))==(20,40,30,5))
# known issue measured (not a failure): style/pole confound
conf=collections.Counter((i['measured_pole']==LET[i['dichotomy']][0], i['item_style']) for i in items)
print('INFO style x (first-letter?) :',dict(conf))
fails=[r for r in res if not r[1]]; print('\nTOTAL',len(res),'checks;',len(fails),'failed'); sys.exit(1 if fails else 0)
