using Assets.Src.Database;
using Assets.Src.Evolution.BattleRoyale;
using Assets.Src.Evolution.Drone;
using Assets.Src.Evolution.Race;
using Assets.Src.Menus;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace Assets.Src.Evolution
{
    public class EditEvolutionConfigControler: MonoBehaviour
    {
        private int _loadedId = -1;
        private bool _hasLoadedExisting;

        public EditGeneralEvolutionConfigController GeneralConfig;

        public EditMutationConfigController MutationConfig;
        public EditMatchConfigController MatchConfig;

        public EditBrConfigController BrConfig;
        public EditDroneConfigController DroneConfig;
        public EditRaceConfigController RaceConfig;

        public Button RunButton;
        public Button CopyButton;
        public Button CancelButton;

        public Button DeleteButton;
        public Button ResetButton;

        public string EvolutionSceneToLoad = "Evolution";
        public string MainMenuSceneToLoad = "MainMenu";

        private EvolutionDatabaseHandler _handler;

        // Use this for initialization
        void Start()
        {
            _handler = new EvolutionDatabaseHandler();
            _handler.InitialiseConnection();
            LoadConfigFromDB();

            RunButton.onClick.AddListener(delegate () { SaveAndRun(); });
            CopyButton.onClick.AddListener(delegate () { SaveNewAndRun(); });
            CancelButton.onClick.AddListener(delegate () { ReturnToMainMenu(); });

            DeleteButton.onClick.AddListener(delegate () {
                if (ArgumentStore.IdToLoad.HasValue)
                {
                    _handler.DeleteConfig(ArgumentStore.IdToLoad.Value);
                    ReturnToMainMenu();
                }
                else
                {
                    Debug.Log("Cannot delete config because there is none loaded.");
                }
            });

            ResetButton.onClick.AddListener(delegate () {
                if (ArgumentStore.IdToLoad.HasValue)
                {
                    _handler.DeleteIndividuals(ArgumentStore.IdToLoad.Value);
                    SaveAndRun();
                }
                else
                {
                    Debug.Log("Cannot delete config because there is none loaded.");
                }
            });
        }
        
        private void ReturnToMainMenu()
        {
            if (!string.IsNullOrEmpty(MainMenuSceneToLoad))
            {
                ArgumentStore.IdToLoad = null;
                _handler.SetAutoloadId(null);
                SceneManager.LoadScene(MainMenuSceneToLoad);
            }
        }

        protected int SaveConfig()
        {
            var config = ReadControls();

            if (_hasLoadedExisting)
            {
                return _handler.UpdateExistingEvolutionConfig(config);
            }
            else
            {
                return _handler.SaveNewEvolutionConfig(config);
            }
        }

        private EvolutionConfig ReadControls()
        {
            var config = GeneralConfig.ReadControls();

            config.BrConfig = BrConfig.ReadControls();
            config.EvolutionDroneConfig = DroneConfig.ReadControls();
            config.MatchConfig = MatchConfig.ReadControls();
            config.MutationConfig = MutationConfig.ReadControls();
            config.RaceConfig = RaceConfig.ReadControls();

            return config;
        }

        private void SaveAndRun()
        {
            _loadedId = SaveConfig();
            ArgumentStore.IdToLoad = _loadedId;

            SceneManager.LoadScene(EvolutionSceneToLoad);
        }

        private int SaveNewConfig()
        {
            var config = ReadControls();

            config.GenerationNumber = 0;

            return _handler.SaveNewEvolutionConfig(config);
        }

        private void SaveNewAndRun()
        {
            _loadedId = SaveNewConfig();

            ArgumentStore.IdToLoad = _loadedId;

            SceneManager.LoadScene(EvolutionSceneToLoad);
        }
        
        private void LoadConfigFromDB()
        {
            _hasLoadedExisting = ArgumentStore.IdToLoad.HasValue;
            _loadedId = ArgumentStore.IdToLoad ?? -1;

            var config = _hasLoadedExisting ? _handler.ReadConfig(_loadedId) : new EvolutionConfig();

            GeneralConfig.PopulateControls(config);
            MatchConfig.PopulateControls(config);
            MutationConfig.PopulateControls(config);
            BrConfig.PopulateControls(config);
            DroneConfig.PopulateControls(config);
            RaceConfig.PopulateControls(config);
        }
    }
}
