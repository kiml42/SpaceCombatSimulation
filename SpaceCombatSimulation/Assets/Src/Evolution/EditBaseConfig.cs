using Assets.Src.Database;
using Assets.Src.Evolution;
using Assets.Src.Menus;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

public abstract class EditBaseConfig : MonoBehaviour {
    protected int _loadedId = -1;
    protected bool _hasLoadedExisting;

    public EditMutationConfig MutationConfig;
    public EditMatchConfig MatchConfig;

    public InputField RunName;
    protected int _generationNumber;
    public InputField MinMatchesPerIndividual;
    public InputField WinnersFromEachGeneration;

    public Button RunButton;
    public Button CoppyButton;
    public Button CancelButton;

    public Button DeleteButton;
    public Button ResetButton;

    public abstract string EvolutionSceneToLoad { get; }
    public abstract string MainMenuSceneToLoad { get; }
    
    // Use this for initialization
    void Start () {
        var handler = Initialise();
        LoadConfigFromDB();
        
        RunButton.onClick.AddListener(delegate () { SaveAndRun(); });
        CoppyButton.onClick.AddListener(delegate () { SaveNewAndRun(); });
        CancelButton.onClick.AddListener(delegate () { ReturnToMainMenu(); });

        DeleteButton.onClick.AddListener(delegate () {
            if (ArgumentStore.IdToLoad.HasValue)
            {
                handler.DeleteConfig(ArgumentStore.IdToLoad.Value);
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
                handler.DeleteIndividuals(ArgumentStore.IdToLoad.Value);
                SaveAndRun();
            }
            else
            {
                Debug.Log("Cannot delete config because there is none loaded.");
            }
        });
    }
    
    public abstract GeneralDatabaseHandler Initialise();

    private void ReturnToMainMenu()
    {
        if (!string.IsNullOrEmpty(MainMenuSceneToLoad))
        {
            SceneManager.LoadScene(MainMenuSceneToLoad);
        }
    }

    protected abstract int SaveConfig();

    private void SaveAndRun()
    {
        _loadedId = SaveConfig();
        ArgumentStore.IdToLoad = _loadedId;
        
        SceneManager.LoadScene(EvolutionSceneToLoad);
    }

    protected abstract int SaveNewConfig();

    private void SaveNewAndRun()
    {
        _loadedId = SaveNewConfig();

        ArgumentStore.IdToLoad = _loadedId;
        
        SceneManager.LoadScene(EvolutionSceneToLoad);
    }

    protected abstract BaseEvolutionConfig LoadSpecificConfigFromDb();

    protected void LoadConfigFromDB()
    {
        _hasLoadedExisting = ArgumentStore.IdToLoad.HasValue;
        _loadedId = ArgumentStore.IdToLoad ?? -1;

        var config = LoadSpecificConfigFromDb();
        
        RunName.text = config.RunName;
        MinMatchesPerIndividual.text = config.MinMatchesPerIndividual.ToString();
        WinnersFromEachGeneration.text = config.WinnersFromEachGeneration.ToString();

        _generationNumber = config.GenerationNumber;
        
        MatchConfig.LoadConfig(config.MatchConfig, _hasLoadedExisting);
        MutationConfig.LoadConfig(config.MutationConfig, _hasLoadedExisting);
    }
}
