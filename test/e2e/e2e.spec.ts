import path from 'path'
import os from 'os'
import fs from 'fs'
import TestBackendProcess from '../utils/testQriBackend'
import TestTempRegistry from '../utils/testTempRegistry'
import fakeDialog from 'spectron-fake-dialog'
import { E2ETestUtils, newE2ETestUtils } from '../utils/e2eTestUtils'

const { Application } = require('spectron')

describe('Qri End to End tests', function spec () {
  let app: any
  let backend: any
  let registry: any
  const imagesDir = process.env.E2E_ARTIFACTS_PATH || os.tmpdir()
  const artifactPath = (s: string): string => {
    return path.join(imagesDir, s)
  }
  console.log(`storing artifacts at: ${imagesDir}`)

  // The utility functions we use to build our e2e tests
  // declared in this scope so they can be accessed by all tests
  // initialized in the `beforeAll` function
  let utils: E2ETestUtils

  const filename = 'e2e_test_csv_dataset.csv'
  const datasetName = 'e2e_test_csv_datasetcsv'

  const filename_1 = 'e2e_test_csv_dataset_1.csv'
  const datasetName_1 = 'e2e_test_csv_dataset_1csv'

  const username = 'fred'
  const email = 'fred@qri.io'
  const password = '1234567890!!'

  const metaCommitTitle = 'made a change to meta'
  const bodyCommitTitle = 'made a change to body'

  beforeAll(async () => {
    jest.setTimeout(60000)

    registry = new TestTempRegistry()
    await registry.start()

    // spin up a new mock backend with a mock registry server attached
    backend = new TestBackendProcess()
    await backend.start()
    // use spectron to launch desktop with programmatic control

    // check the environment variables to determine whether to run headless chrome
    const headless = process.env.HEADLESS_CHROME === 'true'

    // path to the electron application to run with spectron
    // TODO(dlong): The default path here does not work under Windows (WebDriverIO will stall
    // in the `init` fuction, and the app opens multiple times in a retry loop). The path ending
    // in ".exe" will work under Windows. Perhaps other platforms, such as OSX, should also be
    // using the binary in the "dist" folder.
    let electronAppPath = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron')
    if (process.platform === 'win32') {
      electronAppPath = path.join(__dirname, '..', '..', 'node_modules', 'electron',
        'dist', 'electron.exe')
    }

    app = new Application({
      path: electronAppPath,
      args: [path.join(__dirname, '..', '..', 'app')],

      // When running in circleci or in, for example, a docker container with no
      // display, we must run spectron on headless chrome and use xvfb to mock a
      // display. Check the .circleci configuration: the '-browsers' extension on
      // the docker image type gives us an image that contains chrome and xvfb.
      // The `chromeDriverArgs` options configure chrome driver correctly for
      // headless use.
      chromeDriverArgs: headless ? ['headless', 'no-sandbox', 'disable-dev-shm-usage'] : [],
      // Logging will make it easier to debug problems.
      env: {
        ELECTRON_ENABLE_LOGGING: true,
        ELECTRON_ENABLE_STACK_DUMPING: true
      },
      chromeDriverLogPath: path.join(__dirname, '../log/chromedriverlog.txt'),
      webdriverLogPath: path.join(__dirname, '../log/webdriverlog.txt'),
      waitTimeout: 10e3,
      connectionRetryCount: 1
    })
    fakeDialog.apply(app)
    utils = newE2ETestUtils(app)
    return app.start()
  })

  afterAll(async () => {
    await utils.delay(500)
    backend.close()
    registry.close()
    if (app && app.isRunning()) {
      return app.stop()
    }
  })

  it('open window', async () => {
    const { client, browserWindow } = app

    await client.waitUntilWindowLoaded()
    const title = await browserWindow.getTitle()
    expect(title).toBe('Qri Desktop')
  })

  it('accept terms of service by clicking accept and get taken to signup', async () => {
    const {
      atLocation,
      waitForExist,
      click,
      exists
    } = utils

    // Make sure the page is loaded
    await waitForExist('#welcome-page')

    // expected ids
    await exists(['#tos', '#accept'])

    // click to accept the tos
    await click('#accept')

    // make sure we navigated to the correct page
    await atLocation('#/onboard/signup', artifactPath('accept_terms_of_service_by_clicking_accept_and_get_taken_to_signup.png'))
  })

  it('create a new account, taken to datasets page', async () => {
    const {
      atLocation,
      waitForExist,
      click,
      setValue,
      exists
    } = utils

    // Make sure the page is loaded
    await waitForExist('#signup-page')

    // expected ids
    await exists(['#username', '#email', '#password', '#accept'])

    // Input username, email, and password
    await setValue('#username', username)
    await setValue('#email', email)
    await setValue('#password', password)

    // click accept
    await click('#accept')

    // make sure we are on the collection page
    await atLocation('#/collection', artifactPath('create_a_new_account_taken_to_datasets_page.png'))
  })

  // signout and sign in
  it('signout and sign in', async () => {
    const {
      click,
      setValue,
      atLocation
    } = utils

    // click profile
    await click('#nav-options')
    // click signout
    await click('#signout')
    // on signup page
    await atLocation('#/onboard/signup')
    // navigate to signin page
    await click('#signin')
    // ensure we are on signin page
    await atLocation('#/signin')
    // set username and password
    await setValue('#username', username)
    await setValue('#password', password)
    // submit
    await click('#accept')
    // we are left on the collection page
    await atLocation('#/collection')
  })

  it('create new CSV dataset from a data source', async () => {
    const {
      atLocation,
      click,
      expectTextToBe,
      onHistoryTab,
      checkStatus
    } = utils

    // make sure we are on the collection page
    await atLocation('#/collection')

    // click create-dataset to open up the Create Dataset modal
    await click('#create-dataset')

    // mock the dialog and create a temp csv file
    // clicking the '#chooseBodyFilePath' button will connect the fakeDialog
    // to the correct input
    const csvPath = path.join(backend.dir, filename)
    fs.writeFileSync(csvPath, 'e2e_test_bool_col,a,b,c\nfalse,1,2,3\ntrue,4,5,6')
    await fakeDialog.mock([ { method: 'showOpenDialogSync', value: [csvPath] } ])
    await click('#chooseBodyFilePath')

    // submit to create a new dataset
    await click('#submit')

    // ensure we are redirected to the workbench
    await atLocation(`#/workbench`)

    // ensure we have navigated to the correct dataset
    // TODO (ramfox): it's weird that we have to pass in this newline character
    // to get the reference to match. It looks like because the #dataset-reference
    // div divides the peername and name among multiple divs, we get this odd
    // whitespace character
    const reference = `${username}/\n${datasetName}`
    await expectTextToBe('#dataset-reference', reference)

    // enure we are on the history tab
    await onHistoryTab()

    // ensure the body and structure indicate that they were 'added'
    await checkStatus('body', 'added')
    await checkStatus('structure', 'added')
  })

  it('navigate to collection and back to dataset', async () => {
    const {
      atLocation,
      click,
      expectTextToBe,
      onHistoryTab
    } = utils

    await click('#history-tab')
    await onHistoryTab()

    await click('#collection')
    // ensure we have redirected to the collection page
    await atLocation('#/collection')
    // click the dataset
    const ref = `#${username}-${datasetName}`
    await click(ref)
    // ensure we have redirected to the dataset page
    await atLocation(`#/workbench/${username}/${datasetName}`)
    // ensure we are still at the history tab
    await onHistoryTab()
    // ensure we have a commit title
    await expectTextToBe('#commit-title', 'created dataset')
  })

  // checkout
  it('checkout a dataset', async () => {
    const {
      atLocation,
      click,
      onStatusTab,
      exists,
      doesNotExist,
      waitForNotExist
    } = utils

    // at dataset
    await click('#workbench')
    // at status
    await click('#status-tab')
    await onStatusTab()
    // body is disabled
    await exists(['#body-status.disabled'])
    // click #checkout to open checkout modal
    await click('#checkout')
    // mock the dialog
    await fakeDialog.mock([ { method: 'showOpenDialogSync', value: [backend.dir] } ])
    // click #chooseSavePath to open dialog
    await click('#chooseSavePath')
    // click #submit
    await click('#submit')
    // expect modal to be gone
    await waitForNotExist('#checkout-dataset')
    // atLocation
    await atLocation(`#/workbench`)
    // check we are at status tab
    await onStatusTab()
    // expect Body to now be active
    await doesNotExist('#body-status.disabled')
  })

  // body write & commit
  it('write the body to the filesystem & commit', async () => {
    const {
      click,
      checkStatus,
      doesNotExist,
      setValue,
      expectTextToBe,
      onHistoryTab,
      exists
    } = utils

    // on dataset page
    await click('#workbench')
    // on status tab
    await click('#status-tab')
    // no changes, so cannot commit
    await doesNotExist('.clear-to-commit #commit-status')
    // create file in memory and save over the previous body.csv
    const csvPath = path.join(backend.dir, datasetName, 'body.csv')
    fs.writeFileSync(csvPath, 'e2e_test_bool_col,a,b,c\nfalse,1,2,3\ntrue,4,5,6\ntrue,7,8,9')
    // body status should be modified
    await checkStatus('body', 'modified')
    // commit should be active
    await exists(['.clear-to-commit #commit-status'])
    // navigate to commit
    await click('#commit-status')
    // set value of title & message
    const commitMessage = 'modified body using fsi'
    await setValue('#title', bodyCommitTitle)
    await setValue('#message', commitMessage)
    // send accept
    await click('#submit')
    // should be on the history tab
    await onHistoryTab()
    // body status should be modified
    await checkStatus('body', 'modified')
    // title should be the same as title we added
    await expectTextToBe('#commit-title', bodyCommitTitle)
  })

  // meta write and commit
  it('create a meta & commit', async () => {
    const {
      click,
      exists,
      onHistoryTab,
      setValue,
      checkStatus,
      expectTextToBe,
      doesNotExist
    } = utils

    // on dataset page
    await click('#workbench')
    // on status tab
    await click('#status-tab')
    // commit should be disabled
    await doesNotExist('.clear-to-commit #commit-status')
    // click #meta-status
    await click('#meta-status')
    // set value for title and description
    const metaTitle = 'new dataset title'
    const metaDescription = 'new dataset description'
    await setValue('#title', metaTitle)
    await setValue('#description', metaDescription)
    await checkStatus('meta', 'added')
    // commit should be enabled
    await exists(['.clear-to-commit #commit-status'])
    // click #commit-status
    await click('#commit-status')
    // set title and message

    await setValue('#title', metaCommitTitle)
    await setValue('#message', 'commit message')
    // submit
    await click('#submit')
    // on history tab
    await onHistoryTab()
    // meta status should be 'added'
    await checkStatus('meta', 'added')
    // commit title should be the same
    await expectTextToBe('#commit-title', metaCommitTitle)
    // verify meta title and description should be correct
    await click('#meta-status')
    await expectTextToBe('#meta-title', metaTitle)
    await expectTextToBe('#meta-description', metaDescription)
  })

  // switch between commits
  it('switch between commits', async () => {
    const {
      click,
      onHistoryTab,
      atLocation,
      expectTextToBe,
    } = utils

    // make sure we are on the dataset page, looking at history
    await click('#workbench')
    await atLocation(`#/workbench`)
    await click('#history-tab')
    await onHistoryTab()
    await click('#commit-status')

    // click the third commit and check commit-title
    await click('#HEAD-3')
    await expectTextToBe('#commit-title', 'created dataset')

    // click the second commit and check commit-title
    await click('#HEAD-2')
    await expectTextToBe('#commit-title', bodyCommitTitle)

    // click the third commit and check commit-title
    await click('#HEAD-1')
    await expectTextToBe('#commit-title', metaCommitTitle)
  })

  // rename
  it('rename a dataset', async () => {
    const {
      click,
      exists,
      atLocation,
      setValue,
      doesNotExist
    } = utils

    // on dataset
    await click('#workbench')
    // ensure we are on the workbench
    await atLocation(`#/workbench`)
    // click #dataset-name
    await click('#dataset-name')
    // make sure the input exists
    await exists(['#dataset-name-input'])
    // setValue as a bad name
    await setValue('#dataset-name-input', '9test')
    // class should be error
    await exists(['#dataset-name-input.invalid'])
    // setValue as good name
    await setValue('#dataset-name-input', 'test_dataset')
    // get correct class
    await doesNotExist('#dataset-name-input.invalid')
    // submit by clicking away
    await click('#dataset-reference')
  })

  it('create another new CSV dataset from a data source', async () => {
    const {
      atLocation,
      click,
      expectTextToBe,
      onHistoryTab,
      checkStatus
    } = utils

    // make sure we are on the collection page
    await click('#collection')
    await atLocation('#/collection')

    // click create-dataset to open up the Create Dataset modal
    await click('#create-dataset')

    // mock the dialog and create a temp csv file
    // clicking the '#chooseBodyFilePath' button will connect the fakeDialog
    // to the correct input
    const csvPath = path.join(backend.dir, filename_1)
    fs.writeFileSync(csvPath, 'e2e_test_bool_col,x,y,z\nfalse,100,99,98\ntrue,97,96,95')
    await fakeDialog.mock([ { method: 'showOpenDialogSync', value: [csvPath] } ])
    await click('#chooseBodyFilePath')

    // submit to create a new dataset
    await click('#submit')

    // ensure we have redirected to the workbench section
    await atLocation('#/workbench')

    // ensure we have navigated to the correct dataset
    // TODO (ramfox): it's weird that we have to pass in this newline character
    // to get the reference to match. It looks like because the #dataset-reference
    // div divides the peername and name among multiple divs, we get this odd
    // whitespace character
    const reference = `${username}/\n${datasetName_1}`
    await expectTextToBe('#dataset-reference', reference)

    await expectTextToBe('#commit-details-header-entries', '2 entries')

    // enure we are on the history tab
    await onHistoryTab()

    // ensure the body and structure indicate that they were 'added'
    await checkStatus('body', 'added')
    await checkStatus('structure', 'added')
  })

  // remove a dataset is commented out until we have a keyboard command in
  // place to open the remove modal
  // we also must create a `keyboard` function that takes a string
  // and mocks the user typing that string into the keyboard
  // it must handle both windows and mac defaults (ctrl vs cmd)
  // it('remove a dataset', async () => {
  //   const {
  //     click,
  //     exists,
  //     atLocation,
  //     keyboard
  //   } = utils

  //   // on dataset
  //   click('#dataset')
  //   // type command (control) shift r to get remove dataset modal
  //   keyboard('')
  //   // ensure we are on the remove modal
  //   exists(['#remove'])
  //   // select to remove files
  //   click('#should-remove-files')
  //   // click submit
  //   click('#submit')
  //   // end up on collection page
  //   atLocation('#/collection')
  //   // no datasets
  //   exists(['#no-datasets'])
  // })
})
