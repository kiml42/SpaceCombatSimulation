using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;
using Assets.Src.Database;

public class Edit1v1Config : MonoBehaviour {
    public int IdToLoad;

    public EditMutationConfig MutationConfig;
    public EditMatchConfig MatchConfig;

    public InputField RunName;
    public InputField MinMatchesPerIndividual;
    public InputField WinnersFromEachGeneration;
    public InputField GenerationNumber;
    public InputField SuddenDeathDamage;
    public InputField SuddenDeathReloadTime;

    private Evolution1v1DatabaseHandler _handler;

    // Use this for initialization
    void Start () {
        _handler = new Evolution1v1DatabaseHandler();

        LoadConfig();
	}
	
	// Update is called once per frame
	void Update () {
        Debug.Log(RunName.text);
	}

    private void LoadConfig()
    {
        var loaded = _handler.ReadConfig(IdToLoad);

        Debug.Log(loaded.RunName);

        RunName.text = loaded.RunName;
        MinMatchesPerIndividual.text = loaded.MinMatchesPerIndividual.ToString();
        WinnersFromEachGeneration.text = loaded.WinnersFromEachGeneration.ToString();
        GenerationNumber.text = loaded.GenerationNumber.ToString();
        SuddenDeathDamage.text = loaded.SuddenDeathDamage.ToString();
        SuddenDeathReloadTime.text = loaded.SuddenDeathReloadTime.ToString();

        MatchConfig.LoadConfig(loaded.MatchConfig);
        MutationConfig.LoadConfig(loaded.MutationConfig);
    }
}
