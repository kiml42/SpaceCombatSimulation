using Assets.src.Evolution;
using Assets.Src.Evolution;
using System;
using System.Collections.Generic;

public class EvolutionMutationWrapper {
    private MutationConfig _config = new MutationConfig();    
    private StringMutator _mutator;
    public float NewStartersProportion = 0.02f;
    
    public MutationConfig Config { get
        {
            return _config;
        }
        set
        {
            _config = value;
            _mutator.Config = value;
        }
    }

    public EvolutionMutationWrapper()
    {
        _mutator = new StringMutator(Config);
    }


    public List<string> CreateGenerationOfMutants(List<string> baseGenomes)
    {
        var numberOfNewIndividuals = (int)Math.Ceiling(Config.GenerationSize * NewStartersProportion);

        var mutants = _mutator.CreateGenerationOfMutants(baseGenomes, Config.GenerationSize - numberOfNewIndividuals);
        var newIndividuals = CreateNewIndividuals(numberOfNewIndividuals);

        mutants.AddRange(newIndividuals);

        return mutants;
    }

    public List<string> CreateDefaultGeneration()
    {
        return CreateNewIndividuals(Config.GenerationSize);
    }
    
    private List<string> CreateNewIndividuals(int numberOfNewIndividuals)
    {
        var baseGenomes = Config.UseCompletelyRandomDefaultGenome ? null : new List<string> { PadGenome(Config.DefaultGenome) };
        return _mutator.CreateGenerationOfMutants(baseGenomes, numberOfNewIndividuals);
    }

    private string PadGenome(string genome)
    {
        if (string.IsNullOrEmpty(genome))
        {
            return string.Empty.PadRight(_config.GenomeLength);
        }

        while(genome.Length < _config.GenomeLength)
        {
            genome = genome + genome;
        }
        return genome.Substring(0, _config.GenomeLength);
    }

    public string CreateSingleMutant(string original)
    {
        return _mutator.Mutate(original);
    }
}
