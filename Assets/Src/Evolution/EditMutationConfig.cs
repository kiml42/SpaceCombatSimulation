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

    private MutationConfig _loaded;

    public void LoadConfig(MutationConfig config, bool isPreExisting)
    {
        _loaded = config;

        Mutations.text = config.Mutations.ToString();
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
        _loaded = _loaded ?? new MutationConfig();

        _loaded.Mutations = int.Parse(Mutations.text);
        _loaded.MaxMutationLength = int.Parse(MaxMutationLength.text);
        _loaded.GenomeLength = int.Parse(GenomeLength.text);
        _loaded.GenerationSize = int.Parse(GenerationSize.text);
        _loaded.UseCompletelyRandomDefaultGenome = bool.Parse(UseCompletelyRandomDefaultGenome.text);
        _loaded.DefaultGenome = DefaultGenome.text;
       
        if (_hasLoadedExisting)
        {
            _loaded.Id = LoadedId;
        }

        return _loaded;
    }
}
