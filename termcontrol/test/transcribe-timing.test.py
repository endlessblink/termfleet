"""Metadata and prepare regressions; synthetic arrays and fake models only."""
import importlib.util, pathlib, types, unittest
from unittest.mock import patch
import numpy as np
spec=importlib.util.spec_from_file_location('tc_worker', pathlib.Path(__file__).resolve().parents[1]/'bridge/transcribe/worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class Model:
 def __init__(self):self.model=types.SimpleNamespace(device='cpu',compute_type='int8_float32');self.options=None
 def transcribe(self,audio,**options):
  self.options=options
  def segments():yield types.SimpleNamespace(text=' synthetic words ')
  return segments(),None
 def detect_language(self,audio):return 'he',0.99,[]
class Timings(unittest.TestCase):
 def setUp(self):worker._loaded.clear()
 def tearDown(self):worker._loaded.clear()
 def test_metadata_times_consumed_generator_and_preserves_decoding(self):
  model=Model()
  with patch.object(worker,'decode',return_value=np.zeros(16000,np.float32)),patch.object(worker,'WhisperModel',return_value=model):
   reply=worker.transcribe({'path':'/private/clip','language':None})
  self.assertEqual(reply['text'],'synthetic words')
  t=reply['timings'];self.assertEqual(t['audioSeconds'],1)
  for key in ['decodeMs','warmupMs','detectMs','inferenceMs']:self.assertGreaterEqual(t[key],0)
  self.assertEqual(t['computeType'],'int8_float32');self.assertEqual(t['device'],'cpu')
  self.assertTrue(t['coldModel']);self.assertTrue(t['coldDetector'])
  self.assertNotIn('/private',str(t));self.assertNotIn('synthetic words',str(t))
  self.assertEqual(model.options,dict(language='he',beam_size=5,vad_filter=True,condition_on_previous_text=False,temperature=0.0))
 def test_prepare_warms_once_and_never_replaces_an_active_recognizer(self):
  with patch.object(worker,'WhisperModel',side_effect=lambda *a,**kw:Model()) as ctor:
   first=worker.prepare({'language':'he'});second=worker.prepare({'language':'en'})
  self.assertEqual(ctor.call_count,2,'only detector and original Hebrew recognizer are loaded')
  self.assertEqual(first['timings']['model'],worker.MODELS['he'])
  self.assertEqual(second['timings']['model'],worker.MODELS['he'])
  self.assertFalse(second['timings']['coldModel'])
 def test_first_prepare_does_not_guess_a_large_model(self):
  with patch.object(worker,'WhisperModel',return_value=Model()) as ctor:
   reply=worker.prepare({})
  self.assertEqual(ctor.call_count,1)
  self.assertNotIn('model',reply['timings'])
  self.assertEqual(reply['timings']['detector'],worker.DETECTOR)
 def test_custom_model_path_is_not_reported(self):
  with patch.dict(worker.MODELS,{'he':'/private/local-model'}),patch.object(worker,'WhisperModel',return_value=Model()),patch.object(worker,'decode',return_value=np.zeros(16000,np.float32)):
   reply=worker.transcribe({'path':'/private/clip','language':'he'})
  self.assertEqual(reply['timings']['model'],'local/custom')
if __name__=='__main__':unittest.main()
