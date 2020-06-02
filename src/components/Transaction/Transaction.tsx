import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { ethers } from 'ethers';
import makeBlockie from 'ethereum-blockies-base64';
import { observer } from 'mobx-react-lite';
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { AccountState, TokenLike } from 'zksync/build/types';
import { Wallet, Provider, utils } from 'zksync';

import { DataList } from 'components/DataList/DataListNew';
import Modal from 'components/Modal/Modal';
import SaveContacts from 'components/SaveContacts/SaveContacts';
import Spinner from 'components/Spinner/Spinner';
import { CanceledTx } from './CanceledTx';
import { ContactSelectorFlat } from './ContactSelectorFlat';
import { FilteredContactList } from './FilteredContactList';
import { ExecutedTx } from './ExecutedTx';
import { LoadingTx } from './LoadingTx';
import { LockedTx } from './LockedTx';

import { ITransactionProps } from './Types';

import { handleFormatToken } from 'src/utils';

import { ADDRESS_VALIDATION } from 'constants/regExs';
import { INPUT_VALIDATION } from 'constants/regExs';
import { WIDTH_BP, ZK_FEE_MULTIPLIER } from 'constants/magicNumbers';

import { useCancelable } from 'hooks/useCancelable';
import { useStore } from 'src/store/context';
import { useMobxEffect } from 'src/hooks/useMobxEffect';

import { loadTokens, sortBalancesById, mintTestERC20Tokens } from 'src/utils';

import { DEFAULT_ERROR } from 'constants/errors';

import { IEthBalance } from '../../types/Common';

import './Transaction.scss';
import SpinnerWorm from '../Spinner/SpinnerWorm';
import BurnerWallet from '../Wallets/BurnerWallet';

library.add(fas);

const Transaction: React.FC<ITransactionProps> = observer(
  ({
    addressValue,
    balances,
    hash,
    isExecuted,
    isInput,
    isLoading,
    onChangeAddress,
    onChangeAmount,
    price,
    setHash,
    setExecuted,
    setLoading,
    setTransactionType,
    setSymbol,
    title,
    transactionAction,
    type,
  }): JSX.Element => {
    const store = useStore();

    const {
      ethId,
      hint,
      searchBalances,
      searchContacts,
      syncProvider,
      syncWallet,
      tokens,
      unlocked,
      walletAddress,
      zkBalances,
      zkBalancesLoaded,
      zkWallet,
      accountState,
    } = store;

    const cancelable = useCancelable();

    const body = document.querySelector('#body');
    const myRef = useRef<HTMLInputElement>(null);

    const [amount, setAmount] = useState<number>(0);
    const [conditionError, setConditionError] = useState('');
    const [gas, setGas] = useState<string>('');
    const [fee, setFee] = useState<any>();
    const [filteredContacts, setFilteredContacts] = useState<any>([]);
    const [isBalancesListOpen, openBalancesList] = useState<boolean>(false);
    const [isContactsListOpen, openContactsList] = useState<boolean>(false);
    const [isHintUnlocked, setHintUnlocked] = useState<string>('');
    const [isUnlockingProcess, setUnlockingERCProcess] = useState<boolean>(
      false,
    );
    const [isAccountUnlockingProcess, setAccountUnlockingProcess] = useState<
      boolean
    >(false);
    const [inputValue, setInputValue] = useState<string>('');
    const [maxValue, setMaxValue] = useState<number>(
      store.propsMaxValue ? store.propsMaxValue : 0,
    );
    const [selected, setSelected] = useState<boolean>(false);
    const [selectedBalance, setSelectedBalance] = useState<any | undefined>();
    const [selectedContact, setSelectedContact] = useState<any | undefined>();
    const [symbolName, setSymbolName] = useState<string>(
      store.propsSymbolName ? store.propsSymbolName : '',
    );
    const [token, setToken] = useState<string>(
      store.propsToken ? store.propsToken : '',
    );
    const [unlockFau, setUnlockFau] = useState<boolean>(false);
    const [value, setValue] = useState<string>(
      localStorage.getItem('walletName') || '',
    );

    const [refreshTimer, setRefreshTimer] = useState<number | null>(null);

    const history = useHistory();

    const handleUnlock = useCallback(
      async (withLoading: boolean) => {
        try {
          store.hint = 'Follow the instructions in the pop up';
          if (withLoading === true) {
            setAccountUnlockingProcess(true);
            setLoading(true);
          }
          const changePubkey = await zkWallet?.setSigningKey();
          store.hint = 'Confirmed! \n Waiting for transaction to be mined';
          const receipt = await changePubkey?.awaitReceipt();
          store.unlocked = !!receipt;
          setAccountUnlockingProcess(!receipt);
          setLoading(!receipt);
        } catch {
          history.push('/account');
        }
      },
      [setAccountUnlockingProcess, setLoading, zkWallet, store.unlocked],
    );

    useEffect(() => {
      if (
        store.walletName === 'BurnerWallet' &&
        !store.unlocked &&
        zkWallet &&
        title !== 'Deposit'
      ) {
        handleUnlock(true);
      }
    }, [store.unlocked, store.walletName]);

    const getAccState = async () => {
      if (zkWallet && tokens) {
        const _accountState = await zkWallet.getAccountState();
        if (JSON.stringify(accountState) !== JSON.stringify(_accountState)) {
          store.accountState = _accountState;
        }
        const at = _accountState.depositing.balances;
        store.awaitedTokens = at;
        const zkBalance = _accountState.committed.balances;
        const zkBalancePromises = Object.keys(zkBalance).map(async key => {
          return {
            address: tokens[key].address,
            balance: +handleFormatToken(
              zkWallet,
              tokens[key].symbol,
              zkBalance[key] ? zkBalance[key].toString() : '0',
            ),
            symbol: tokens[key].symbol,
          };
        });
        Promise.all(zkBalancePromises)
          .then(res => {
            store.zkBalances = res;
          })
          .catch(err => {
            err.name && err.message
              ? (store.error = `${err.name}: ${err.message}`)
              : (store.error = DEFAULT_ERROR);
          });
      }

      if (
        JSON.stringify(accountState?.verified.balances) !==
        JSON.stringify(store.verified)
      ) {
        store.verified = accountState?.verified.balances;
      }
    };

    const loadEthTokens = useCallback(async () => {
      const { tokens } = await loadTokens(
        syncProvider as Provider,
        syncWallet as Wallet,
        accountState as AccountState,
      );

      const balancePromises = Object.keys(tokens).map(async key => {
        if (tokens[key].symbol && syncWallet) {
          const balance = await syncWallet.getEthereumBalance(key);
          return {
            id: tokens[key].id,
            address: tokens[key].address,
            balance: +handleFormatToken(
              syncWallet,
              tokens[key].symbol,
              +balance ? balance.toString() : '0',
            ),
            symbol: tokens[key].symbol,
          };
        }
      });

      await Promise.all(balancePromises)
        .then(res => {
          const _balances = res
            .filter(token => token && token.balance > 0)
            .sort(sortBalancesById);
          const _balancesEmpty = res
            .filter(token => token?.balance === 0)
            .sort(sortBalancesById);
          _balances.push(..._balancesEmpty);
          store.ethBalances = _balances as IEthBalance[];
        })
        .catch(err => {
          err.name && err.message
            ? (store.error = `${err.name}: ${err.message}`)
            : (store.error = DEFAULT_ERROR);
        });
    }, [
      accountState,
      store.error,
      store.ethBalances,
      syncWallet,
      syncProvider,
    ]);

    useEffect(() => {
      const _t = setInterval(() => loadEthTokens(), 3000);
      return () => {
        clearInterval(_t);
      };
    }, [loadEthTokens]);

    useEffect(() => {
      if (title === 'Deposit') {
        loadEthTokens();
      } else {
        getAccState();
      }
    }, [isBalancesListOpen]);

    const refreshBalances = useCallback(async () => {
      if (zkWallet && syncProvider && syncWallet && accountState) {
        await cancelable(
          loadTokens(syncProvider, syncWallet, accountState),
        ).then(async res => {
          if (JSON.stringify(zkBalances) !== JSON.stringify(res.zkBalances)) {
            store.zkBalances = res.zkBalances;
            await cancelable(zkWallet?.getAccountState())
              .then((res: any) => {
                store.verified = res?.verified.balances;
              })
              .then(() => {
                zkWallet?.isSigningKeySet().then(data => {
                  store.unlocked = data;
                });
              });
          }
          if (JSON.stringify(tokens) !== JSON.stringify(res.tokens)) {
            store.tokens = res.tokens;
          }
        });
      }
      const timeout = setTimeout(refreshBalances, 2000);
      setRefreshTimer(timeout as any);
    }, [
      accountState,
      syncProvider,
      syncWallet,
      zkWallet,
      zkBalances,
      store,
      tokens,
      title,
      store.unlocked,
    ]);

    const submitCondition =
      (ADDRESS_VALIDATION['eth'].test(addressValue) ||
        (title === 'Deposit' && unlockFau)) &&
      selectedBalance &&
      inputValue &&
      +inputValue > 0 &&
      +inputValue <= maxValue;

    useEffect(() => {
      if (
        addressValue.length > 0 &&
        !ADDRESS_VALIDATION['eth'].test(addressValue)
      ) {
        setConditionError(
          `Error: "${addressValue}" doesn't match ethereum address format`,
        );
      } else {
        setConditionError('');
      }
    }, [addressValue]);

    const validateNumbers = useCallback(
      e => {
        const amountBigNumber = store.zkWallet?.provider.tokenSet.parseToken(
          symbolName,
          e.toString(),
        );
        const maxBigValue = store.zkWallet?.provider.tokenSet.parseToken(
          symbolName,
          maxValue.toString(),
        );
        if (INPUT_VALIDATION.digits.test(e) && amountBigNumber && maxBigValue) {
          setInputValue(e);
          title === 'Deposit'
            ? onChangeAmount(
                +amountBigNumber + +gas > +maxBigValue
                  ? +amountBigNumber
                  : +amountBigNumber,
              )
            : onChangeAmount(
                +amountBigNumber + +fee >=
                  +ethers.utils.parseEther(maxValue.toString())
                  ? +amountBigNumber
                  : +amountBigNumber,
              );
        }
      },
      [fee, gas, maxValue, onChangeAmount, setInputValue, title],
    );

    const setWalletName = useCallback(() => {
      if (value && value !== ethId) {
        localStorage.setItem('walletName', value);
      } else {
        setValue(localStorage.getItem('walletName') || ethId);
      }
    }, [ethId, value]);

    const handleFee = useCallback(
      (e, symbol?) => {
        if (title !== 'Deposit') {
          zkWallet?.provider
            .getTransactionFee(
              title === 'Withdraw' ? 'Withdraw' : 'Transfer',
              token,
              symbol ? symbol : symbolName,
            )
            .then(res => setFee(res.zkpFee));
        }
      },
      [symbolName, title, zkWallet, token],
    );

    const handleSelect = useCallback(
      name => {
        if (isContactsListOpen) {
          setSelectedContact(name);
        }
        if (isBalancesListOpen) {
          setSelectedBalance(name);
        }
      },
      [
        isBalancesListOpen,
        isContactsListOpen,
        onChangeAddress,
        handleFee,
        inputValue,
      ],
    );

    const handleClickOutside = useCallback(
      e => {
        if (e.target.getAttribute('data-name')) {
          e.stopPropagation();
          openContactsList(false);
          openBalancesList(false);
          body?.classList.remove('fixed-b');
        }
      },
      [body],
    );

    const handleSave = useCallback(() => {
      if (addressValue && ADDRESS_VALIDATION['eth'].test(addressValue)) {
        store.modalSpecifier = 'add-contact';
      } else {
        setConditionError(
          `Error: "${addressValue}" doesn't match ethereum address format`,
        );
      }
    }, [addressValue, setConditionError, store]);

    const handleFilterContacts = useCallback(
      e => {
        if (!searchContacts) return;
        const searchValue = searchContacts.filter(({ name, address }) => {
          return ADDRESS_VALIDATION['eth'].test(e) &&
            address.toLowerCase().includes(e.toLowerCase())
            ? (setSelectedContact(name),
              handleSelect(name),
              (store.walletAddress = { name, address }),
              onChangeAddress(address))
            : name.toLowerCase().includes(e.toLowerCase());
        });
        if (searchValue.length === 0) {
          handleSelect('');
          store.walletAddress = {};
          setSelectedContact('');
        }
        setFilteredContacts(searchValue);
      },
      [
        addressValue,
        searchContacts,
        handleSelect,
        onChangeAddress,
        setFilteredContacts,
        setSelectedContact,
        store,
      ],
    );

    const handleCancel = useCallback(() => {
      setTransactionType(undefined);
      setHash('');
      setExecuted(false);
      store.walletAddress = {};
      setLoading(false);
      setSelectedBalance('');
      setSelectedContact('');
      onChangeAddress('');
      handleFilterContacts('');
    }, [
      handleFilterContacts,
      onChangeAddress,
      setExecuted,
      setHash,
      setLoading,
      setSelectedBalance,
      setSelectedContact,
      setTransactionType,
      store,
    ]);

    useEffect(() => {
      if (title === 'Withdraw' && zkWallet && selectedContact !== null) {
        store.walletAddress = {
          name: 'Own account',
          address: zkWallet?.address(),
        };
        onChangeAddress(zkWallet?.address());
      }
    }, [zkWallet]);

    useEffect(() => {
      setExecuted(false);
    }, [zkWallet, setExecuted]);

    useEffect(() => {
      return () => {
        store.propsMaxValue = null;
        store.propsSymbolName = null;
        store.propsToken = null;
      };
    }, []);

    useMobxEffect(() => {
      store.searchBalances =
        title === 'Deposit' ? store.ethBalances : zkBalances;
      cancelable(zkWallet?.getAccountState())
        .then((res: any) => {
          store.verified = res?.verified.balances;
        })
        .then(() => {
          cancelable(zkWallet?.isSigningKeySet()).then(
            data => (store.unlocked = data),
          );
        });
    }, [
      cancelable,
      store,
      zkWallet,
      store.searchBalances,
      title,
      store.unlocked,
    ]);

    const handleManageUnlockingTokens = () => {
      const _inUnlocking = store.tokenInUnlockingProgress;
      const _index = _inUnlocking.indexOf(token);
      if (_index >= 0) {
        _inUnlocking.splice(_index, 1);
        store.tokenInUnlockingProgress = _inUnlocking;
      }
    };

    useMobxEffect(() => {
      if ((token && token === 'ETH') || symbolName === 'ETH') {
        setUnlockFau(true);
      }
      if (balances?.length === 1) {
        setToken(
          !!balances[0].address || balances[0].symbol === 'ETH'
            ? balances[0].address
            : balances[0].symbol,
        );
        setMaxValue(balances[0].balance);
        setSelectedBalance(balances[0].symbol);
        setSymbolName(balances[0].symbol);
        setSymbol(balances[0].symbol);
      }
      if (token && zkWallet && symbolName !== 'ETH') {
        zkWallet.isERC20DepositsApproved(token).then(res => {
          setUnlockFau(res);
          if (res === true) {
            handleManageUnlockingTokens();
          }
        });
      }
      if (store.propsToken) {
        setSymbol(store.propsToken);
        setSelectedBalance(store.propsToken);
        setSelected(true);
        setConditionError('');
      }
      if (
        ADDRESS_VALIDATION['eth'].test(addressValue) &&
        !selectedContact &&
        title !== 'Withdraw'
      ) {
        searchContacts?.filter(el => {
          if (el.address.toLowerCase().includes(addressValue.toLowerCase())) {
            setSelectedContact(el.name);
            handleSelect(el.name);
            store.walletAddress = { name: el.name, address: el.address };
            onChangeAddress(el.address);
          }
        });
      }

      if (unlockFau && isUnlockingProcess) {
        setUnlockFau(true);
        handleManageUnlockingTokens();
        setUnlockingERCProcess(false);
        setLoading(false);
      }

      ethers
        .getDefaultProvider()
        .getGasPrice()
        .then(res => res.toString())
        .then(data => {
          setGas(data);
        });
      document.addEventListener('click', handleClickOutside, true);
      return () => {
        document.removeEventListener('click', handleClickOutside, true);
      };
    }, [
      addressValue,
      balances,
      searchContacts,
      body,
      gas,
      filteredContacts,
      handleCancel,
      handleClickOutside,
      handleSelect,
      isBalancesListOpen,
      isContactsListOpen,
      isUnlockingProcess,
      isLoading,
      onChangeAddress,
      selected,
      selectedContact,
      setFilteredContacts,
      setLoading,
      setMaxValue,
      setSelected,
      setSelectedContact,
      setSymbol,
      setSymbolName,
      setToken,
      setUnlockFau,
      setUnlockingERCProcess,
      setWalletName,
      symbolName,
      title,
      token,
      unlocked,
      unlockFau,
      walletAddress,
      zkWallet,
      store,
      store.propsToken,
      store.tokenInUnlockingProgress,
    ]);

    const handleShowHint = useCallback(
      text => {
        setHintUnlocked(text);
        setTimeout(() => {
          setHintUnlocked('');
        }, 3000);
      },
      [setHintUnlocked],
    );

    const handleUnlockERC = useCallback(() => {
      setUnlockingERCProcess(true);
      setLoading(true);
      store.hint = 'Follow the instructions in the pop up';
      zkWallet
        ?.approveERC20TokenDeposits(token)
        .then(res => {
          setLoading(false);
          setUnlockingERCProcess(false);
          store.tokenInUnlockingProgress = store.tokenInUnlockingProgress.concat(
            [token],
          );
          store.hint = `Waiting for transaction to be mined\n \n ${res.hash}`;
          return res;
        })
        .then(data => {
          return data;
        })
        .catch(() => {
          setLoading(false);
          setUnlockingERCProcess(false);
        });
      const setUnlocked = async () => {
        const checkApprove = await zkWallet
          ?.isERC20DepositsApproved(token)
          .then(res => res);
        if (checkApprove) {
          handleManageUnlockingTokens();
          setUnlockFau(checkApprove);
          setUnlockingERCProcess(false);
        }
      };
      setUnlocked();
      if (!unlockFau && store.tokenInUnlockingProgress.includes(token)) {
        setInterval(() => {
          setUnlocked();
        }, 1000);
      }
    }, [
      setLoading,
      token,
      unlockFau,
      zkWallet,
      store.tokenInUnlockingProgress,
    ]);

    const handleInputWidth = useCallback(
      e => {
        const el = myRef.current;
        if (el) {
          el.style.minWidth =
            (window?.innerWidth > WIDTH_BP ? 260 : 120) + 'px';
          el.style.width =
            (e === maxValue && e.toString() !== '0'
              ? e.toString().length
              : el.value.length + 1) + 'ch';
        }
      },
      [inputValue, maxValue],
    );

    const handleSumbit = useCallback(() => {
      if (submitCondition) {
        transactionAction(token, type, symbolName);
      }
      if (!selectedBalance || (inputValue && +inputValue <= 0) || !inputValue) {
        setConditionError('Please select token and amount value');
      }
      if (
        !ADDRESS_VALIDATION['eth'].test(addressValue) &&
        title !== 'Deposit'
      ) {
        setConditionError('Adress does not match ethereum address format');
      }
    }, [
      addressValue,
      inputValue,
      selectedBalance,
      setConditionError,
      unlockFau,
    ]);

    const selectFilteredContact = (name, address) => {
      handleSelect(name);
      store.walletAddress = { name, address };
      onChangeAddress(address);
      openContactsList(false);
      setSelectedContact(name);
      setConditionError('');
      body?.classList.remove('fixed-b');
      setFilteredContacts([]);
    };

    const ContactList = ({ address, name }) => (
      <div
        className='balances-contact'
        key={name}
        onClick={() => {
          handleSelect(name);
          store.walletAddress = { name, address };
          onChangeAddress(address);
          openContactsList(false);
          setConditionError('');
          setSelected(true);
          body?.classList.remove('fixed-b');
          setFilteredContacts([]);
        }}
      >
        <div className='balances-contact-left'>
          <p className='balances-contact-name'>{name}</p>
          <span className='balances-contact-address'>
            {window?.innerWidth > WIDTH_BP
              ? address
              : address?.replace(
                  address?.slice(14, address?.length - 4),
                  '...',
                )}
          </span>
        </div>
        <div className='balances-contact-right'></div>
      </div>
    );

    const BalancesList = ({ address, symbol, balance }) => (
      <div
        onClick={() => {
          setToken(address);
          setMaxValue(balance);
          setSymbolName(symbol);
          setSymbol(symbol);
          handleSelect(symbol);
          openBalancesList(false);
          setSelected(true);
          setConditionError('');
          handleFee(inputValue, symbol);
          body?.classList.remove('fixed-b');
        }}
        key={address}
        className='balances-token'
      >
        <div className='balances-token-left'>
          {/* <div className={`logo ${symbol}`}></div> */}
          <div className='balances-token-name'>
            <p>{symbol}</p>
          </div>
        </div>
        <div className='balances-token-right'>
          <span>
            {window?.innerWidth > WIDTH_BP && 'balance:'}
            <p className='datalist-balance'>
              {+balance < 0.000001
                ? 0
                : parseFloat(balance.toFixed(8).toString())}
            </p>
          </span>
          {title === 'Deposit' && (
            <button
              onClick={e => {
                e.stopPropagation();
                store.modalSpecifier = 'sign-metamask';
                symbol === 'ETH'
                  ? window.open('https://faucet.rinkeby.io/')
                  : mintTestERC20Tokens(
                      zkWallet as Wallet,
                      symbol as TokenLike,
                      store,
                    );
              }}
              className='undo-btn'
            >
              {symbol === 'ETH' ? (
                <>
                  {'Get some Rinkeby ETH '}
                  <FontAwesomeIcon icon={['fas', 'external-link-alt']} />
                </>
              ) : (
                'Click to mint some tokens'
              )}
            </button>
          )}
        </div>
      </div>
    );

    const burnerWalletAccountUnlockCondition =
      store.walletName === 'BurnerWallet' &&
      !store.unlocked && title !== 'Deposit';

    return (
      <>
        <Modal
          visible={false}
          classSpecifier='sign-metamask'
          background={false}
          centered={true}
        >
          <h2 className='transaction-title'>{'Minting token'}</h2>
          <p>{'Follow the instructions in the pop up'}</p>
          <Spinner />
          <button
            onClick={() => (store.modalSpecifier = '')}
            className='btn btn-cancel btn-tr '
          >
            {'Close'}
          </button>
        </Modal>
        <Modal
          visible={false}
          classSpecifier='add-contact'
          clickOutside={false}
          background={true}
          centered
        >
          <SaveContacts
            title='Add contact'
            addressValue={addressValue}
            addressInput={false}
          />
        </Modal>
        <div
          className={`assets-wrapper ${
            isContactsListOpen || isBalancesListOpen ? 'open' : 'closed'
          }`}
        >
          {isContactsListOpen && (
            <DataList
              data={searchContacts}
              title='Select contact'
              header={() => (
                <>
                  <button
                    onClick={() => {
                      openContactsList(false);
                      body?.classList.remove('fixed-b');
                    }}
                    className='close-icon'
                  ></button>
                  <div className='assets-border-bottom'></div>
                </>
              )}
              visible={true}
              renderItem={contact => (
                <ContactList address={contact.address} name={contact.name} />
              )}
              emptyListComponent={() =>
                !searchContacts ? <p>{'The contact list is empty'}</p> : null
              }
            />
          )}
          {isBalancesListOpen && (
            <DataList
              data={searchBalances}
              title={`Balances in ${title === 'Deposit' ? 'L1' : 'L2'}`}
              header={() => (
                <button
                  onClick={() => {
                    openBalancesList(false);
                    body?.classList.remove('fixed-b');
                  }}
                  className='close-icon'
                ></button>
              )}
              visible={true}
              renderItem={({ address, symbol, balance }) => (
                <BalancesList
                  address={address}
                  symbol={symbol}
                  balance={balance}
                />
              )}
              emptyListComponent={() =>
                !searchBalances.length ? (
                  <p>
                    {
                      'No balances yet, please make a deposit or request money from someone!'
                    }
                  </p>
                ) : null
              }
            />
          )}
        </div>
        <div className='transaction-wrapper'>
          {unlocked === false &&
            unlocked !== undefined &&
            !isAccountUnlockingProcess &&
            title !== 'Deposit' &&
            store.walletName !== 'BurnerWallet' && (
              <LockedTx
                handleCancel={handleCancel}
                handleUnlock={() => handleUnlock(true)}
              />
            )}
          {isExecuted && (
            <ExecutedTx
              addressValue={addressValue}
              hash={hash}
              handleCancel={handleCancel}
              inputValue={inputValue}
              setTransactionType={setTransactionType}
              symbolName={symbolName}
              title={title}
            />
          )}
          {((!isExecuted &&
            (unlocked === undefined || isLoading || !zkBalancesLoaded)) ||
            burnerWalletAccountUnlockCondition) && (
            <>
              <LoadingTx
                isAccountUnlockingProcess={isAccountUnlockingProcess}
                isUnlockingProcess={isUnlockingProcess}
                inputValue={inputValue}
                symbolName={symbolName}
                addressValue={addressValue}
                handleCancel={handleCancel}
                isLoading={isLoading}
                setWalletName={setWalletName}
                title={title}
                unlockFau={unlockFau}
                setLoading={setLoading}
                setAccountUnlockingProcess={setAccountUnlockingProcess}
                setUnlockingERCProcess={setUnlockingERCProcess}
              />
              {hint.match(/(?:denied)/i) && !isLoading && (
                <CanceledTx
                  handleCancel={handleCancel}
                  setWalletName={setWalletName}
                />
              )}
            </>
          )}
          {zkWallet &&
            zkBalancesLoaded &&
            !isLoading &&
            !isExecuted &&
            unlocked !== undefined &&
            (unlocked || title === 'Deposit') &&
            !burnerWalletAccountUnlockCondition && (
              <>
                <button
                  onClick={() => {
                    handleCancel();
                    store.walletAddress = {};
                    setTransactionType(undefined);
                    history.goBack();
                  }}
                  className='transaction-back'
                ></button>
                <h2 className='transaction-title'>{title}</h2>
                {(unlocked || title === 'Deposit') &&
                unlocked !== undefined &&
                searchBalances.length ? (
                  <>
                    {isInput && (
                      <>
                        <span className='transaction-field-title'>
                          {'To address'}
                        </span>
                        <div
                          className={`transaction-field contacts ${ADDRESS_VALIDATION[
                            'eth'
                          ].test(addressValue)}`}
                        >
                          <ContactSelectorFlat
                            body={body}
                            isContactsListOpen={isContactsListOpen}
                            openContactsList={openContactsList}
                            selectedContact={selectedContact}
                          />
                          <div className='currency-input-wrapper'>
                            {ADDRESS_VALIDATION['eth'].test(addressValue) && (
                              <img
                                src={makeBlockie(addressValue)}
                                alt='blockie-icon'
                                className='transaction-blockie'
                              />
                            )}
                            <input
                              placeholder='Ox address or contact name'
                              value={addressValue}
                              onChange={e => {
                                onChangeAddress(e.target.value);
                                handleFilterContacts(e.target.value);
                                store.walletAddress = {};
                                if (
                                  ADDRESS_VALIDATION['eth'].test(addressValue)
                                ) {
                                  setConditionError('');
                                }
                              }}
                              className='currency-input-address'
                            />
                            {ADDRESS_VALIDATION['eth'].test(addressValue) &&
                              !selectedContact &&
                              !walletAddress.name && (
                                <button
                                  className='add-contact-button-input btn-tr'
                                  onClick={() => handleSave()}
                                >
                                  <span></span>
                                  <p>{'Save'}</p>
                                </button>
                              )}
                            {!addressValue ? (
                              <div
                                className={`custom-selector contacts ${
                                  selectedContact &&
                                  walletAddress.address &&
                                  addressValue === walletAddress.address
                                    ? ''
                                    : 'short'
                                }`}
                              >
                                <div
                                  onClick={() => {
                                    openContactsList(!isContactsListOpen);
                                    body?.classList.add('fixed-b');
                                  }}
                                  className={`custom-selector-title ${
                                    selectedContact &&
                                    walletAddress.address &&
                                    addressValue === walletAddress.address
                                      ? ''
                                      : 'short'
                                  }`}
                                >
                                  {(selectedContact || !walletAddress.name) &&
                                  walletAddress.address &&
                                  addressValue === walletAddress.address ? (
                                    <p>{selectedContact}</p>
                                  ) : (
                                    <span></span>
                                  )}
                                  <div className='arrow-down'></div>
                                </div>
                              </div>
                            ) : (
                              <button
                                className='cross-clear'
                                onClick={() => {
                                  onChangeAddress('');
                                  handleFilterContacts('');
                                  store.walletAddress = {};
                                  setSelectedContact(null);
                                }}
                              ></button>
                            )}
                          </div>
                        </div>
                        {!!filteredContacts.length && addressValue && (
                          <FilteredContactList
                            filteredContacts={filteredContacts}
                            selectFilteredContact={selectFilteredContact}
                          />
                        )}
                      </>
                    )}
                    <>
                      <span className='transaction-field-title'>
                        {'Amount / asset'}
                      </span>
                      <div className='transaction-field balance'>
                        <div className='currency-input-wrapper border'>
                          <div className='scroll-wrapper'>
                            <input
                              placeholder={selectedBalance ? '0.00' : ''}
                              className='currency-input'
                              key='input1'
                              type='tel'
                              ref={myRef}
                              onChange={e => {
                                validateNumbers(+e.target.value);
                                setAmount(+e.target.value);
                                handleInputWidth(+e.target.value);
                                setInputValue(e.target.value);
                                handleFee(+e.target.value);
                                if (!!inputValue && +inputValue < maxValue) {
                                  setConditionError('');
                                }
                              }}
                              value={inputValue.toString().replace(/-/g, '')}
                            />
                          </div>
                          <div className='custom-selector balances'>
                            <div
                              onClick={() => {
                                openBalancesList(!isBalancesListOpen);
                                body?.classList.add('fixed-b');
                              }}
                              className='custom-selector-title'
                            >
                              {symbolName ? (
                                <p>{symbolName}</p>
                              ) : (
                                <span>
                                  {zkBalancesLoaded ? (
                                    'Select token'
                                  ) : (
                                    <Spinner />
                                  )}
                                </span>
                              )}
                              <div className='arrow-down'></div>
                            </div>
                          </div>
                        </div>
                        {zkBalancesLoaded &&
                          (!!balances?.length ? (
                            <div className='currency-input-wrapper' key={token}>
                              <div className='all-balance-wrapper'>
                                {selectedBalance && (
                                  <span>
                                    {'~$'}
                                    {
                                      +(
                                        +(price && !!price[selectedBalance]
                                          ? price[selectedBalance]
                                          : 1) *
                                        (inputValue ? Math.abs(+inputValue) : 0)
                                      ).toFixed(2)
                                    }
                                  </span>
                                )}
                              </div>
                              <button
                                className='all-balance btn-tr'
                                onClick={() => {
                                  if (maxValue > 0.000001) {
                                    setInputValue(maxValue.toString());
                                    validateNumbers(maxValue);
                                    handleInputWidth(maxValue);
                                    handleFee(+maxValue);
                                    setAmount(+maxValue);
                                  } else {
                                    setConditionError(
                                      'Your balance is too low',
                                    );
                                  }
                                }}
                              >
                                {selectedBalance && (
                                  <>
                                    {'Max:'}
                                    {maxValue ? maxValue.toFixed(10) : '0'}{' '}
                                  </>
                                )}
                                {symbolName ? symbolName : ''}
                              </button>
                            </div>
                          ) : (
                            <div className='currency-input-wrapper' key={token}>
                              <span>{'You have no balances'}</span>
                            </div>
                          ))}
                      </div>
                    </>
                    <div className={`hint-unlocked ${!!isHintUnlocked}`}>
                      {isHintUnlocked}
                    </div>
                    {title === 'Deposit' && token !== 'ETH' && selectedBalance && (
                      <>
                        <div className={`hint-unlocked ${!!isHintUnlocked}`}>
                          {isHintUnlocked}
                        </div>
                        <div className='fau-unlock-wrapper'>
                          <div className='fau-unlock-wrapper'>
                            {unlockFau ? (
                              <p>
                                {symbolName.length
                                  ? symbolName
                                  : balances?.length && balances[0].symbol}
                                {' token unlocked'}
                              </p>
                            ) : (
                              <p>
                                {`${
                                  store.tokenInUnlockingProgress.includes(token)
                                    ? 'Unlocking'
                                    : 'Unlock'
                                } `}
                                {symbolName.length
                                  ? symbolName
                                  : balances?.length && balances[0].symbol}
                                {' token'}
                              </p>
                            )}
                            <button
                              onClick={() =>
                                handleShowHint(
                                  'Click on the switch will call ERC20.approve() for our contract once in order to authorize token deposits.',
                                )
                              }
                              className='hint-question-mark'
                            >
                              {'?'}
                            </button>
                          </div>
                          {store.tokenInUnlockingProgress.includes(token) ? (
                            <SpinnerWorm />
                          ) : (
                            <button
                              onClick={() =>
                                !unlockFau
                                  ? handleUnlockERC()
                                  : handleShowHint(
                                      'Already unlocked. This only needs to be done once per token.',
                                    )
                              }
                              className={`fau-unlock-tocken ${unlockFau}`}
                            >
                              <span
                                className={`fau-unlock-tocken-circle ${unlockFau}`}
                              ></span>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                    <div className='error-container'>
                      <p
                        className={`error-text ${
                          (!!inputValue &&
                            selectedBalance &&
                            +inputValue >= maxValue) ||
                          !!conditionError
                            ? 'visible'
                            : ''
                        }`}
                      >
                        {!!inputValue &&
                        selectedBalance &&
                        +inputValue > maxValue
                          ? 'Not enough balance'
                          : conditionError}
                      </p>
                    </div>
                    <button
                      className={`btn submit-button ${
                        (!unlockFau && title === 'Deposit') ||
                        !inputValue ||
                        (!!inputValue && +inputValue > maxValue) ||
                        !submitCondition
                          ? 'disabled'
                          : ''
                      }`}
                      onClick={handleSumbit}
                    >
                      <span
                        className={`submit-label ${title} ${
                          submitCondition ? true : false
                        }`}
                      ></span>
                      {title}
                    </button>
                    <div className='transaction-fee-wrapper'>
                      <p key={maxValue} className='transaction-fee'>
                        {!!selectedBalance &&
                          !!submitCondition &&
                          !!inputValue &&
                          title !== 'Deposit' && (
                            <>
                              {'Fee: '}
                              {store.zkWallet &&
                                symbolName &&
                                fee &&
                                handleFormatToken(
                                  store.zkWallet,
                                  symbolName,
                                  fee.toString(),
                                )}
                            </>
                          )}
                      </p>
                    </div>
                  </>
                ) : null}
                {unlocked &&
                  unlocked !== undefined &&
                  !searchBalances.length &&
                  title !== 'Deposit' &&
                  zkBalancesLoaded &&
                  zkWallet && (
                    <>
                      <p>
                        {
                          'No balances yet, please make a deposit or request money from someone!'
                        }
                      </p>
                      <button
                        className='btn submit-button'
                        onClick={() => {
                          store.transactionType = 'deposit';
                          history.push('/deposit');
                        }}
                      >
                        {'Deposit'}
                      </button>
                    </>
                  )}
              </>
            )}
        </div>
      </>
    );
  },
);

export default Transaction;
