import importlib.util, pathlib, unittest, datetime as dt
spec=importlib.util.spec_from_file_location('watch',pathlib.Path(__file__).parents[1]/'tools/outlier_watch.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class WatchTest(unittest.TestCase):
 def test_relative_baseline_is_same_account_mature_and_excludes_candidate_pinned_paid_missing(self):
  now=dt.datetime(2026,11,6,tzinfo=dt.timezone.utc)
  def p(i,v,days=10,**extra): return dict(shortCode=str(i),videoPlayCount=v,timestamp=(now-dt.timedelta(days=days)).isoformat(),**extra)
  posts=[p(i,100) for i in range(12)]+[p('win',1000),p('fresh',900000,1),p('pinned',900000,isPinned=True),p('ad',900000,paidPartnership=True),p('none',None),p('old',900000,500)]
  rows,summary=m.rank_accounts({'a':posts,'b':[p(i,5000) for i in range(15)]},now)
  winner=next(r for r in rows if r['id']=='win')
  self.assertEqual(winner['ratio'],10);self.assertEqual(winner['baseline_n'],12)
  self.assertEqual(next(r for r in rows if r['handle']=='b')['ratio'],1)
 def test_small_sample_zero_median_and_missing_views_never_invent_ratios(self):
  now=dt.datetime(2026,11,6,tzinfo=dt.timezone.utc)
  rows,_=m.rank_accounts({'a':[dict(shortCode='one',videoPlayCount=100,timestamp='2026-10-01T00:00:00Z')]},now)
  self.assertIsNone(rows[0]['ratio'])
  rows,_=m.rank_accounts({'a':[dict(shortCode=str(i),videoPlayCount=0,timestamp='2026-10-01T00:00:00Z') for i in range(15)]},now)
  self.assertTrue(all(r['ratio'] is None for r in rows))
if __name__=='__main__':unittest.main()
