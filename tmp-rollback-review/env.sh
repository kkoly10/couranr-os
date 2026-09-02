export PGBIN=/usr/lib/postgresql/16/bin
export BASE=/var/lib/postgresql/rbrev
export PORT=55987
export DB=couranr_rbrev
export ROOT=/home/user/couranr-os
q() { $PGBIN/psql -h 127.0.0.1 -p $PORT -U postgres -d $DB -tA -q -v ON_ERROR_STOP=1 "$@"; }
