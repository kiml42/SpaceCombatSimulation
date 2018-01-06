using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using Assets.Src.Evolution;

public class EditMutationConfig : MonoBehaviour {

    public InputField Mutations;

    public InputField AllowedCharacters;

    public InputField MaxMutationLength;

    public InputField GenomeLength;

    public InputField GenerationSize;

    public InputField UseCompletelyRandomDefaultGenome;

    public InputField DefaultGenome;

    private int LoadedId;
    private bool _hasLoadedExisting = false;

    public void LoadConfig(MutationConfig config, bool isPreExisting)
    {
        Mutations.text = config.Mutations.ToString();
        AllowedCharacters.text = config.AllowedCharacters;
        MaxMutationLength.text = config.MaxMutationLength.ToString();
        GenomeLength.text = config.GenomeLength.ToString();
        GenerationSize.text = config.GenerationSize.ToString();
        UseCompletelyRandomDefaultGenome.text = config.UseCompletelyRandomDefaultGenome.ToString();
        DefaultGenome.text = config.DefaultGenome.ToString();

        LoadedId = config.Id;
        _hasLoadedExisting = isPreExisting;
    }

    public MutationConfig ReadFromControls()
    {
        var config = new MutationConfig()
        {
            Mutations = int.Parse(Mutations.text),
            AllowedCharacters = AllowedCharacters.text,
            MaxMutationLength = int.Parse(MaxMutationLength.text),
            GenomeLength = int.Parse(GenomeLength.text),
            GenerationSize = int.Parse(GenerationSize.text),
            UseCompletelyRandomDefaultGenome = bool.Parse(UseCompletelyRandomDefaultGenome.text),
            DefaultGenome = DefaultGenome.text
        };
        if (_hasLoadedExisting)
        {
            config.Id = LoadedId;
        }

        return config;
    }
}
