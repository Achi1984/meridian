import importlib.util, unittest, urllib.error, io, pathlib
from unittest.mock import patch
p=pathlib.Path(__file__).resolve().parent / 'recovery_http.py'
s=importlib.util.spec_from_file_location('http_candidate',p); h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
class Failure(Exception):
 def __init__(self,status): self.status=status
class Core:
 BRANCH='pilot/version-history-ledger-20261011-t4-recovery1'
 ApiFailure=Failure
 @staticmethod
 def draft_payload(): return {'head':Core.BRANCH,'base':'main','draft':True}
class Response:
 status=200
 def __init__(self,data=b'{}'):self.data=data
 def read(self,n):return self.data[:n]
 def __enter__(self):return self
 def __exit__(self,*a):pass
class Tests(unittest.TestCase):
 def setUp(self):
  self.api=h.GitHub('job-fixture',Core);self.calls=[]
  self.clock=patch.object(h.time,'time',return_value=1791736000);self.clock.start();self.addCleanup(self.clock.stop)
 def opener(self,request,**kw):self.calls.append(request);return Response()
 def test_job_cannot_publish_or_force_or_claim_other_branch(self):
  with patch.object(h.urllib.request,'build_opener') as o:
   for path,method,payload in [('pulls','POST',Core.draft_payload()),('git/refs','POST',{'ref':'refs/heads/main'}),('git/refs/heads/'+Core.BRANCH,'PATCH',{'sha':'a'*40,'force':True})]:
    with self.assertRaises(ValueError):self.api(path,method,payload)
   o.assert_not_called()
 def test_app_only_exact_draft_payload_and_separate_credential(self):
  with patch.object(h.urllib.request,'build_opener') as o:
   for path,method,payload,token in [('git/refs','POST',{},'ghs_fixture'),('pulls','POST',{'draft':False},'ghs_fixture'),('pulls','GET',Core.draft_payload(),'ghs_fixture'),('pulls','POST',Core.draft_payload(),'job-fixture')]:
    with self.assertRaises(ValueError):self.api(path,method,payload,201,publisher_token=token)
   o.assert_not_called()
 def test_bad_json_never_succeeds(self):
  for raw in (b'{"a":1,"a":2}',b'{"a":NaN}',b'{"a":Infinity}'):
   with self.assertRaises(ValueError):h.strict_json(raw)
 def test_only_actual_404_mapped_as_absence(self):
  with patch.object(h.urllib.request,'build_opener') as o:
   o.return_value.open.side_effect=urllib.error.HTTPError('https://api.github.com',404,'missing',{},None)
   with self.assertRaises(Failure) as e:self.api('git/ref/heads/missing')
   self.assertEqual(e.exception.status,404)
   o.return_value.open.side_effect=TimeoutError('404 text is not HTTP404')
   with self.assertRaises(ValueError):self.api('git/ref/heads/missing')
 def test_redirect_download_strips_credentials(self):
  target='https://test.blob.core.windows.net/path?sig=fixture'
  with patch.object(h.urllib.request,'build_opener') as o:
   def open_(request,**kw):
    self.calls.append(request)
    if len(self.calls)==1:raise urllib.error.HTTPError(request.full_url,302,'redirect',{'Location':target},None)
    return Response(b'archive')
   o.return_value.open.side_effect=open_
   self.assertEqual(self.api.signed_download('actions/artifacts/11705462075/zip',20),b'archive')
   self.assertEqual(self.calls[0].get_header('Authorization'),'Bearer job-fixture')
   self.assertIsNone(self.calls[1].get_header('Authorization'))
 def test_untrusted_redirect_and_expiry_stop(self):
  with patch.object(h.urllib.request,'build_opener') as o:
   o.return_value.open.side_effect=urllib.error.HTTPError('x',302,'redirect',{'Location':'https://evil.invalid/path'},None)
   with self.assertRaises(ValueError):self.api.signed_download('actions/artifacts/11705462075/zip',20)
   self.assertEqual(o.return_value.open.call_count,1)
  with patch.object(h.time,'time',return_value=1791738000),patch.object(h.urllib.request,'build_opener') as o:
   with self.assertRaises(ValueError):self.api('git/commits','POST',{})
   o.assert_not_called()
if __name__=='__main__':unittest.main()
