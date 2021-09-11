SELECT BaseIndividual.generation, matchesPlayed, matchesSurvived, completeKills, totalKills, score, cost, modules, species, subspecies
  FROM DroneShootingIndividual
       LEFT JOIN
       BaseIndividual ON BaseIndividual.runConfigId = DroneShootingIndividual.runConfigId AND 
                         BaseIndividual.generation = DroneShootingIndividual.generation AND 
                         BaseIndividual.genome = DroneShootingIndividual.genome
 WHERE BaseIndividual.runConfigId = 1
 ORDER BY BaseIndividual.generation DESC,
          score DESC
 LIMIT 200;

SELECT BaseIndividual.generation, wins, draws, loses, score, cost, modules, species, subspecies
  FROM Individual1v1
       LEFT JOIN
       BaseIndividual ON BaseIndividual.runConfigId = Individual1v1.runConfigId AND 
                         BaseIndividual.generation = Individual1v1.generation AND 
                         BaseIndividual.genome = Individual1v1.genome
 WHERE BaseIndividual.runConfigId = 1
 ORDER BY BaseIndividual.generation DESC,
          score DESC
 LIMIT 200;