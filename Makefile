
TESTS=tests/*.js
MONGO_CONNECTION?=mongodb://localhost/test_db
CUSTOMCONNSTR_mongo_settings_collection?=test_settings
CUSTOMCONNSTR_mongo_collection?=test_sgvs
BOWER=$(shell which ./node_modules/.bin/bower)

BLANKET=--require blanket 

all: test

build:
	${BOWER} install
	# EXPERIMENT 1
	mv .bowerrc not.bowerrc
	# (cd ./node_modules/Drywall; node ../.bin/bower install)
	# EXPERIMENT 2
	# cat ./node_modules/.bin/drywall-compile
	# EXPERIMENT 3
	node ./node_modules/.bin/drywall-compile
	mv not.bowerrc .bowerrc
travis-cov:
	NODE_ENV=test node_modules/.bin/mocha ${BLANKET} -R 'travis-cov' ${TESTS}

coveralls:
	NODE_ENV=test \
	./node_modules/.bin/mocha ${BLANKET} -R mocha-lcov-reporter \
     ${TESTS} | ./coverall.sh

coverhtml:
	./node_modules/.bin/mocha ${BLANKET} -R html-cov  ${TESTS} > tests/coverage.html

test:
	MONGO_CONNECTION=${MONGO_CONNECTION} \
	CUSTOMCONNSTR_mongo_collection=${CUSTOMCONNSTR_mongo_collection} \
	CUSTOMCONNSTR_mongo_settings_collection=${CUSTOMCONNSTR_mongo_settings_collection} \
    mocha --verbose -vvv -R tap ${TESTS}

precover:
	./node_modules/.bin/mocha ${BLANKET} ${SHOULD} -R html-cov ${TESTS} | w3m -T text/html


travis: test travis-cov coveralls coverhtml

.PHONY: test
