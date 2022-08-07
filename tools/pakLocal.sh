pushd `dirname $0`/../packaged
rm -rf *
npm pack ..
PakName=`ls`
tar -xzvf $PakName
rm $PakName
popd
