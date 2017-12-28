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

    public void LoadConfig(MutationConfig config)
    {
        Mutations.text = config.Mutations.ToString();
        AllowedCharacters.text = config.AllowedCharacters;
        MaxMutationLength.text = config.MaxMutationLength.ToString();
        GenomeLength.text = config.GenomeLength.ToString();
        GenerationSize.text = config.GenerationSize.ToString();
        UseCompletelyRandomDefaultGenome.text = config.UseCompletelyRandomDefaultGenome.ToString();
        DefaultGenome.text = config.DefaultGenome.ToString();
    }

    public MutationConfig ReadFromControls()
    {
        var config = new MutationConfig();
        config.Mutations = Mutations.text;
        config.AllowedCharacters = AllowedCharacters.text;
        config.MaxMutationLength = MaxMutationLength.text;
        config.GenomeLength = GenomeLength.text;
        config.GenerationSize = GenerationSize.text;
        config.UseCompletelyRandomDefaultGenome = UseCompletelyRandomDefaultGenome.text;
        config.DefaultGenome = DefaultGenome.text;

        return config;
    }
}
