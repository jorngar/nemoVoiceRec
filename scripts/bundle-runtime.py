"""Make the native runtime relocatable, including Homebrew dependencies."""
import pathlib, shutil, subprocess
root = pathlib.Path(__file__).resolve().parent.parent
source = root / '.runtime/nemo-v3'
target = root / '.runtime/speech-bundle'
shutil.copytree(source, target, dirs_exist_ok=True, symlinks=False)
queue = [target / 'bin/nemo-speech', *list((target / 'lib').glob('*.dylib'))]
visited = set()
while queue:
    binary = queue.pop(0)
    if binary in visited:
        continue
    visited.add(binary)
    output = subprocess.check_output(['otool', '-L', str(binary)], text=True)
    for line in output.splitlines()[1:]:
        dependency = line.strip().split(' (')[0]
        if dependency.startswith('/opt/homebrew/'):
            dest = target / 'lib' / pathlib.Path(dependency).name
            if not dest.exists():
                shutil.copy2(dependency, dest)
                queue.append(dest)
            replacement = '@loader_path/' + dest.name if binary.parent.name == 'lib' else '@executable_path/../lib/' + dest.name
            subprocess.run(['install_name_tool', '-change', dependency, replacement, str(binary)], check=True, capture_output=True)
    if binary.suffix == '.dylib':
        subprocess.run(['install_name_tool', '-id', '@rpath/' + binary.name, str(binary)], check=True, capture_output=True)
    subprocess.run(['codesign', '--force', '--sign', '-', str(binary)], check=True, capture_output=True)
licenses = target / 'share/licenses/nemo-speech/third_party'
for name in ['sentencepiece', 'abseil']:
    installed = pathlib.Path('/opt/homebrew/opt') / name
    for filename in ['LICENSE', 'COPYING', 'AUTHORS']:
        if (installed / filename).exists():
            (licenses / name).mkdir(parents=True, exist_ok=True)
            shutil.copy2(installed / filename, licenses / name / filename)
print(f'Bundled {len(visited)} native binaries in {target}')
