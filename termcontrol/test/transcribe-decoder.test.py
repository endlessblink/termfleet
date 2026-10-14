"""Synthetic offline mobile audio containers; no microphone, model or network."""
import importlib.util, pathlib, subprocess, tempfile, unittest
spec=importlib.util.spec_from_file_location('tc_worker', pathlib.Path(__file__).resolve().parents[1]/'bridge/transcribe/worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class MobileAudio(unittest.TestCase):
 def test_mobile_formats(self):
  with tempfile.TemporaryDirectory(prefix='tc-audio-fixture-') as directory:
   for ext,codec in [('wav','pcm_s16le'),('webm','libopus'),('m4a','aac')]:
    with self.subTest(format=ext):
     file=pathlib.Path(directory)/('silent.'+ext)
     subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','1','-c:a',codec,str(file)],check=True)
     audio=worker.decode(str(file))
     self.assertEqual(audio.dtype.name,'float32');self.assertGreaterEqual(len(audio),16000);self.assertLess(abs(float(audio.max())),0.001)
if __name__=='__main__':unittest.main()
