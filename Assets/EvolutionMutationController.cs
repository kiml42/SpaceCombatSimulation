using Assets.src.Evolution;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class EvolutionMutationController : MonoBehaviour {

    public int Mutations = 3;

    public string AllowedCharacters = " 0123456789  ";

    public int MaxMutationLength = 5;

    public int GenomeLength = 50;

    public int GenerationSize = 20;
    
    public bool UseCompletelyRandomDefaultGenome = false;
    public string DefaultGenome = "";

    private StringMutator _mutator;

    void Start()
    {
        _mutator = new StringMutator
        {
            AllowedCharacters = AllowedCharacters,
            GenomeLength = GenomeLength,
            MaxMutationLength = MaxMutationLength,
            Mutations = Mutations
        };
    }

    public List<string> CreateGenerationOfMutants(List<string> baseGenomes)
    {
        return _mutator.CreateGenerationOfMutants(baseGenomes, GenerationSize);
    }

    public List<string> CreateDefaultGeneration()
    {
        var defaultGenomes = UseCompletelyRandomDefaultGenome ? null : new List<string> { DefaultGenome };
        return CreateGenerationOfMutants(defaultGenomes);
    }
}
